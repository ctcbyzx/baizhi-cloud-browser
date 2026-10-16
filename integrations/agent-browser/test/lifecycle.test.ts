import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CapyApiError, CapyClient, type CapyApi } from "../src/client.ts";
import { BudgetExpired, EndBudget } from "../src/budget.ts";
import { readConfig } from "../src/config.ts";
import { Lifecycle } from "../src/lifecycle.ts";
import { StateStore } from "../src/state.ts";
import type { CapyConfig, CreateBody, SessionProjection } from "../src/types.ts";

class MockCapy implements CapyApi {
  createCalls: Array<{ key: string; body: Record<string, unknown> }> = [];
  controlCalls: string[] = [];
  stopCalls: string[] = [];
  sessions = new Map<string, SessionProjection>();
  controlNumber = 0;
  failFirstCreate = false;
  private idSequence = 0;

  async create(key: string, body: Record<string, unknown>) {
    this.createCalls.push({ key, body: structuredClone(body) });
    const existing = [...this.sessions.values()].find((x) => (x as SessionProjection & { idem?: string }).idem === key);
    if (existing) return structuredClone(existing);
    const session: SessionProjection & { idem?: string } = { session_id: `sess-${++this.idSequence}`, status: "ready", billing: { status: "reserved" }, idem: key };
    this.sessions.set(session.session_id, session);
    if (this.failFirstCreate && this.createCalls.length === 1) throw new CapyApiError("transport");
    return structuredClone(session);
  }

  async get(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new CapyApiError("http", 404);
    return structuredClone(session);
  }

  async control(id: string) {
    this.controlCalls.push(id);
    return { cdp_url: `wss://cdp.test/devtools/browser/${id}?lease=${++this.controlNumber}`, expires_at: new Date(Date.now() + 60_000).toISOString() };
  }

  async stop(id: string) {
    this.stopCalls.push(id);
    const session = this.sessions.get(id);
    assert.ok(session);
    session.status = "stopping";
    return structuredClone(session);
  }
}

async function fixture(api: CapyApi, overrides: Partial<CapyConfig> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "capy-provider-test-"));
  const config: CapyConfig = {
    baseUrl: "http://127.0.0.1:9/openapi/v1",
    apiKey: "test-api-key",
    stateDir: dir,
    readyTimeoutMs: 1_000,
    pollIntervalMs: 1,
    requestTimeoutMs: 100,
    releaseTimeoutMs: 100,
    settlementTimeoutMs: 100,
    ...overrides,
  };
  return { config, lifecycle: new Lifecycle(config, new StateStore(dir), api, async () => {}), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("uncertain create retries exactly the same key and body, and reconnect reuses one Session with a fresh URL", async () => {
  const api = new MockCapy();
  api.failFirstCreate = true;
  const f = await fixture(api, { profileId: "prof_existing", maxSeconds: 180 });
  try {
    const first = await f.lifecycle.launch("task-alpha");
    const again = await f.lifecycle.launch("task-alpha");
    assert.equal(first.cdpUrl.includes("lease=1"), true);
    assert.equal(again.cdpUrl.includes("lease=2"), true);
    assert.equal(api.createCalls.length, 2);
    assert.equal(api.createCalls[0]?.key, api.createCalls[1]?.key);
    assert.deepEqual(api.createCalls[0]?.body, api.createCalls[1]?.body);
    assert.deepEqual(api.createCalls[0]?.body, { purpose: "agent", profile_id: "prof_existing", max_seconds: 180 });
    assert.equal(api.controlCalls.length, 2);
    assert.equal(api.controlCalls[0], api.controlCalls[1]);
    assert.equal(api.sessions.size, 1);
  } finally { await f.cleanup(); }
});

test("same task concurrent launches are serialized; different task names remain isolated", async () => {
  const api = new MockCapy();
  const f = await fixture(api);
  try {
    const [a1, a2, b] = await Promise.all([
      f.lifecycle.launch("task-a"),
      f.lifecycle.launch("task-a"),
      f.lifecycle.launch("task-b"),
    ]);
    assert.equal(api.createCalls.length, 2);
    assert.notEqual(api.createCalls[0]?.key, api.createCalls[1]?.key);
    assert.notEqual(a1.cleanup.sessionId, b.cleanup.sessionId);
    assert.equal(a1.cleanup.sessionId, a2.cleanup.sessionId);
    assert.equal(api.sessions.size, 2);
  } finally { await f.cleanup(); }
});

test("profile id is mapped only as an optional create argument", async () => {
  const api = new MockCapy();
  const f = await fixture(api, { profileId: "prof_123" });
  try {
    await f.lifecycle.launch("profile-task");
    assert.equal(api.createCalls[0]?.body.profile_id, "prof_123");
  } finally { await f.cleanup(); }
});

test("a user-owned Session is never stopped without explicit confirmation", async () => {
  const api = new MockCapy();
  api.sessions.set("provided-session", { session_id: "provided-session", status: "ready", billing: { status: "reserved" } });
  const f = await fixture(api, { existingSessionId: "provided-session" });
  try {
    await f.lifecycle.launch("user-task");
    await assert.rejects(f.lifecycle.end("user-task"), /user-owned/);
    assert.equal(api.stopCalls.length, 0);
    const report = await f.lifecycle.end("user-task", true);
    assert.equal(report.end_accepted, true);
    assert.deepEqual(api.stopCalls, ["provided-session"]);
    assert.equal(api.createCalls.length, 0);
  } finally { await f.cleanup(); }
});

test("stop acceptance, release, and final settlement are recorded independently", async () => {
  const api = new MockCapy();
  const f = await fixture(api);
  try {
    await f.lifecycle.launch("finish-task");
    let getCount = 0;
    const originalGet = api.get.bind(api);
    api.get = async (id: string) => {
      const value = await originalGet(id);
      getCount++;
      if (getCount === 1) return { ...value, status: "released", ended_at: "2026-10-14T01:00:00.000Z", billing: { status: "settling" } };
      return { ...value, status: "released", ended_at: "2026-10-14T01:00:00.000Z", billing: { status: "settled", actual_charge_centipoints: 125 } };
    };
    const report = await f.lifecycle.end("finish-task");
    assert.equal(report.end_accepted, true);
    assert.equal(report.released, true);
    assert.equal(report.settled, true);
    assert.equal(report.billing_status, "settled");
    assert.equal(report.actual_charge_centipoints, 125);
    assert.ok(report.end_accepted_at);
    assert.equal(report.released_at, "2026-10-14T01:00:00.000Z");
  } finally { await f.cleanup(); }
});

test("production billing.charge_stop_at survives pending end and settlement retry", async () => {
  const api = new MockCapy();
  const f = await fixture(api, { releaseTimeoutMs: 5, settlementTimeoutMs: 5 });
  const chargeStopAt = "2026-10-14T09:36:38.385003Z";
  try {
    await f.lifecycle.launch("prod-billing-shape");
    api.sessions.get("sess-1")!.billing = { status: "settling", charge_stop_at: chargeStopAt };
    api.get = async (id: string) => ({ session_id: id, status: "released", ended_at: chargeStopAt, billing: { status: "settling", charge_stop_at: chargeStopAt } });
    const pending = await f.lifecycle.end("prod-billing-shape");
    assert.equal(pending.end_accepted, true);
    assert.equal(pending.released, true);
    assert.equal(pending.billing_status, "settling");
    assert.equal(pending.charge_stop_at, chargeStopAt);
    assert.equal((await f.lifecycle.inspect("prod-billing-shape"))?.billing?.charge_stop_at, chargeStopAt);
    api.get = async (id: string) => ({ session_id: id, status: "released", ended_at: chargeStopAt, billing: { status: "settled", charge_stop_at: null, actual_charge_centipoints: 282 } });
    const settled = await f.lifecycle.end("prod-billing-shape");
    assert.equal(settled.charge_stop_at, chargeStopAt);
    assert.equal(settled.actual_charge_centipoints, 282);
    assert.equal((await f.lifecycle.inspect("prod-billing-shape"))?.billing?.charge_stop_at, chargeStopAt);
    assert.deepEqual(api.stopCalls, ["sess-1"]);
  } finally { await f.cleanup(); }
});

test("inspect persists a confirmed stop time for later inspect and pending end retries", async () => {
  const api = new MockCapy();
  const f = await fixture(api, { releaseTimeoutMs: 5, settlementTimeoutMs: 5 });
  const chargeStopAt = "2026-10-15T01:02:03.000Z";
  try {
    await f.lifecycle.launch("inspect-first");
    api.get = async (id: string) => ({ session_id: id, status: "released", billing: { status: "settling", charge_stop_at: chargeStopAt } });
    assert.equal((await f.lifecycle.inspect("inspect-first"))?.billing?.charge_stop_at, chargeStopAt);
    api.get = async (id: string) => ({ session_id: id, status: "released", billing: { status: "settling" } });
    assert.equal((await f.lifecycle.inspect("inspect-first"))?.billing?.charge_stop_at, chargeStopAt);
    const pending = await f.lifecycle.end("inspect-first");
    assert.equal(pending.charge_stop_at, chargeStopAt);
    assert.equal(pending.billing_status, "settling");
    api.get = async (id: string) => ({ session_id: id, status: "released", billing: { status: "settled", actual_charge_centipoints: 7 } });
    const settled = await f.lifecycle.end("inspect-first");
    assert.equal(settled.charge_stop_at, chargeStopAt);
    assert.equal(settled.billing_status, "settled");
    assert.deepEqual(api.stopCalls, ["sess-1"]);
  } finally { await f.cleanup(); }
});

test("inspect rejects missing or different Session IDs without changing saved state", async () => {
  const api = new MockCapy();
  const f = await fixture(api);
  try {
    await f.lifecycle.launch("identity-bound");
    const statePath = join(f.config.stateDir, `${createHash("sha256").update("identity-bound").digest("hex")}.json`);
    const before = await readFile(statePath, "utf8");
    for (const wrong of ["sess-other", undefined]) {
      api.get = async () => ({ ...(wrong ? { session_id: wrong } : {}), status: "released", billing: { status: "settled", charge_stop_at: "2026-10-15T02:00:00Z" } }) as SessionProjection;
      await assert.rejects(f.lifecycle.inspect("identity-bound"), /different Session ID/);
      assert.equal(await readFile(statePath, "utf8"), before);
    }
  } finally { await f.cleanup(); }
});

test("inspect does not inherit another task's confirmed stop time", async () => {
  const api = new MockCapy();
  const f = await fixture(api);
  try {
    await f.lifecycle.launch("first-task");
    await f.lifecycle.launch("second-task");
    api.get = async (id: string) => ({ session_id: id, status: "released", billing: id === "sess-1" ? { status: "settled", charge_stop_at: "2026-10-15T01:00:00Z" } : { status: "settled" } });
    assert.equal((await f.lifecycle.inspect("first-task"))?.billing?.charge_stop_at, "2026-10-15T01:00:00Z");
    assert.equal((await f.lifecycle.inspect("second-task"))?.billing?.charge_stop_at, undefined);
  } finally { await f.cleanup(); }
});

test("ended Session is never replaced by a new launch", async () => {
  const api = new MockCapy();
  const f = await fixture(api);
  try {
    await f.lifecycle.launch("no-recreate");
    api.sessions.get("sess-1")!.status = "released";
    await assert.rejects(f.lifecycle.launch("no-recreate"), /refusing to replace/);
    assert.equal(api.createCalls.length, 1);
  } finally { await f.cleanup(); }
});

test("API credentials require HTTPS except explicit loopback HTTP, and redirects are not followed", async () => {
  const env = { CAPYBROWSER_API_KEY: "review-secret", CAPYBROWSER_BASE_URL: "http://remote.example" };
  assert.throws(() => readConfig(env), /HTTPS|loopback/i);
  assert.throws(() => readConfig({ ...env, CAPYBROWSER_BASE_URL: "https://user:pass@remote.example" }), /userinfo|credential/i);
  const config = readConfig({ ...env, CAPYBROWSER_BASE_URL: "http://127.0.0.1:3210" });
  assert.equal(config.baseUrl, "http://127.0.0.1:3210/openapi/v1");
  let calls = 0;
  const client = new CapyClient(config, (async (_url, init) => {
    calls++;
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://other.example/steal" } });
  }) as typeof fetch);
  await assert.rejects(client.get("sess"), /Baizhi Cloud Browser API rejected/);
  assert.equal(calls, 1);
});

test("saved Session refuses endpoint, credential, Profile, and max duration drift before API access", async () => {
  const api = new MockCapy();
  const f = await fixture(api, { profileId: "prof-a", maxSeconds: 180 });
  try {
    await f.lifecycle.launch("bound-task");
    const savedPath = join(f.config.stateDir, `${createHash("sha256").update("bound-task").digest("hex")}.json`);
    const savedRaw = await readFile(savedPath, "utf8");
    assert.equal(savedRaw.includes(f.config.apiKey), false);
    const saved = JSON.parse(savedRaw) as { binding: { endpoint: string; credentialFingerprint: string; launchBody: CreateBody } };
    assert.equal(saved.binding.endpoint, f.config.baseUrl);
    assert.match(saved.binding.credentialFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(saved.binding.launchBody, { purpose: "agent", profile_id: "prof-a", max_seconds: 180 });
    const variants: Partial<CapyConfig>[] = [
      { baseUrl: "https://different.example/openapi/v1" },
      { apiKey: "different-key" },
      { profileId: "prof-b" },
      { maxSeconds: 181 },
    ];
    for (const change of variants) {
      const drifted = new Lifecycle({ ...f.config, ...change }, new StateStore(f.config.stateDir), api);
      await assert.rejects(drifted.launch("bound-task"), /restore.*original|configuration.*changed/i);
      await assert.rejects(drifted.inspect("bound-task"), /restore.*original|configuration.*changed/i);
      await assert.rejects(drifted.end("bound-task"), /restore.*original|configuration.*changed/i);
    }
    assert.equal(api.createCalls.length, 1);
    assert.equal(api.controlCalls.length, 1);
    assert.equal(api.stopCalls.length, 0);
    const original = await f.lifecycle.inspect("bound-task");
    assert.equal(original?.session_id, "sess-1");
  } finally { await f.cleanup(); }
});

test("aged empty and corrupt crash locks can be recovered before explicit end", async () => {
  const api = new MockCapy();
  const f = await fixture(api);
  try {
    await f.lifecycle.launch("crash-task");
    const lock = join(f.config.stateDir, `${createHash("sha256").update("crash-task").digest("hex")}.lock`);
    for (const content of ["", "{bad-json"]) {
      await writeFile(lock, content, { flag: "wx" });
      const old = new Date(Date.now() - 60_000);
      await utimes(lock, old, old);
      const removed = await (new StateStore(f.config.stateDir) as unknown as { removeDeadLock(path: string): Promise<boolean> }).removeDeadLock(lock);
      assert.equal(removed, true);
    }
    api.get = async (id: string) => ({ session_id: id, status: "released", billing: { status: "settled" } });
    const report = await f.lifecycle.end("crash-task");
    assert.equal(report.end_accepted, true);
    assert.equal(report.released, true);
  } finally { await f.cleanup(); }
});

test("lock metadata write failure removes its own lock, and concurrent stale recovery remains serialized", async () => {
  const dir = await mkdtemp(join(tmpdir(), "capy-lock-review-"));
  const lockFor = (task: string) => join(dir, `${createHash("sha256").update(task).digest("hex")}.lock`);
  try {
    const broken = new StateStore(dir, async (path) => {
      const file = await open(path, "wx", 0o600);
      file.writeFile = async () => { throw new Error("injected lock metadata write failure"); };
      return file;
    });
    await assert.rejects(broken.withTask("write-fail", async () => {}), /injected lock metadata/);
    await assert.rejects(stat(lockFor("write-fail")), { code: "ENOENT" });
    await new StateStore(dir).withTask("write-fail", async () => {});

    const stale = lockFor("concurrent");
    await writeFile(stale, "{bad-json", { flag: "wx" });
    const old = new Date(Date.now() - 60_000);
    await utimes(stale, old, old);
    await mkdir(`${stale}.reaper`);
    await utimes(`${stale}.reaper`, old, old);
    let active = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 8 }, () => new StateStore(dir).withTask("concurrent", async () => {
      active++;
      peak = Math.max(peak, active);
      await delay(5);
      active--;
    })));
    assert.equal(peak, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("end reports pending, waived, and review-required billing without false settlement", async () => {
  const api = new MockCapy();
  const f = await fixture(api, { releaseTimeoutMs: 10, settlementTimeoutMs: 10 });
  try {
    const absent = await f.lifecycle.end("absent");
    assert.equal(absent.end_accepted, false);
    await f.lifecycle.launch("pending-task");
    const pending = await f.lifecycle.end("pending-task");
    assert.equal(pending.end_accepted, true);
    assert.equal(pending.released, false);
    assert.equal(pending.billing_final, false);
    const originalGet = api.get.bind(api);
    api.get = async (id: string) => ({ session_id: id, status: "released", billing: { status: "waived", actual_charge_centipoints: 0 } });
    const waived = await f.lifecycle.end("pending-task");
    assert.equal(waived.released, true);
    assert.equal(waived.billing_final, true);
    assert.equal(waived.waived, true);
    assert.equal(waived.settled, false);
    assert.equal(api.stopCalls.length, 1, "released follow-up must not repeat DELETE");
    api.get = originalGet;
    await f.lifecycle.launch("review-task");
    api.get = async (id: string) => ({ session_id: id, status: "released", billing: { status: "review_required" } });
    const review = await f.lifecycle.end("review-task");
    assert.equal(review.review_required, true);
    assert.equal(review.billing_final, false);
    api.get = originalGet;
    await f.lifecycle.launch("expiry-task");
    api.get = async (id: string) => ({ session_id: id, status: "released", expires_at: "2026-10-14T01:00:00.000Z", billing: { status: "settled" } });
    await assert.rejects(f.lifecycle.launch("expiry-task"), /refusing to replace/);
    const expired = await f.lifecycle.end("expiry-task");
    assert.equal(expired.end_accepted, false);
    assert.equal(expired.released, true);
    assert.match(expired.next_action ?? "", /confirm expiry/);
  } finally { await f.cleanup(); }
});

test("end budget starts before the state lock and reports no facts when lock acquisition expires", async () => {
  const api = new MockCapy();
  const f = await fixture(api);
  try {
    await f.lifecycle.launch("held-task");
    let entered!: () => void;
    const acquired = new Promise<void>((resolve) => entered = resolve);
    const holder = new StateStore(f.config.stateDir).withTask("held-task", async () => { entered(); await delay(60); });
    await acquired;
    const budget = new EndBudget(20);
    try {
      const report = await f.lifecycle.end("held-task", false, budget);
      assert.equal(report.facts_obtained, false);
      assert.equal(report.stop_outcome, "unknown");
      assert.equal(report.end_accepted, null);
      assert.equal(report.released, null);
      assert.equal(report.release_status, "unknown");
      assert.equal(report.budget_exhausted, true);
      assert.match(report.next_action ?? "", /no Session facts were read/);
      assert.equal(api.stopCalls.length, 0);
    } finally { budget.dispose(); }
    await holder;
  } finally { await f.cleanup(); }
});

test("response-body wait is aborted by the shared budget", async () => {
  const f = await fixture(new MockCapy());
  const budget = new EndBudget(20);
  let aborted = false;
  try {
    const client = new CapyClient(f.config, (async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":'));
        init?.signal?.addEventListener("abort", () => { aborted = true; controller.error(new Error("aborted")); }, { once: true });
      },
    }), { status: 200 })) as typeof fetch);
    await assert.rejects(client.get("body-stall", budget.window()), BudgetExpired);
    assert.equal(aborted, true);
  } finally { budget.dispose(); await f.cleanup(); }
});

test("deadline after release preserves accepted and released facts and billing retry skips DELETE", async () => {
  const api = new MockCapy();
  const f = await fixture(api, { releaseTimeoutMs: 100, settlementTimeoutMs: 100, pollIntervalMs: 10 });
  try {
    await f.lifecycle.launch("billing-clock");
    api.get = async (id: string) => ({ session_id: id, status: "released", charge_stop_at: "2026-10-14T01:00:00.000Z", billing: { status: "settling" } });
    const budget = new EndBudget(20);
    let pending;
    try { pending = await f.lifecycle.end("billing-clock", false, budget); }
    finally { budget.dispose(); }
    assert.equal(pending.end_accepted, true);
    assert.equal(pending.released, true);
    assert.equal(pending.billing_status, "settling");
    assert.equal(pending.charge_stop_at, "2026-10-14T01:00:00.000Z");
    assert.equal(pending.budget_exhausted, true);
    api.get = async (id: string) => ({ session_id: id, status: "released", billing: { status: "settled" } });
    const finished = await f.lifecycle.end("billing-clock");
    assert.equal(finished.settled, true);
    assert.equal(api.stopCalls.length, 1);
  } finally { await f.cleanup(); }
});
