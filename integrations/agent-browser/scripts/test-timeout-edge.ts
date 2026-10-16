import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readConfig } from "../src/config.ts";
import { StateStore, bindingFor, newTaskState } from "../src/state.ts";

const root = new URL("../", import.meta.url).pathname;
const installedProvider = process.env.CAPYBROWSER_TEST_INSTALLED_PROVIDER;
const provider = installedProvider || join(root, "dist", "plugin.js");
const agentBrowser = join(root, "node_modules", "agent-browser", "bin", "agent-browser.js");
const scratch = await mkdtemp(join(tmpdir(), "capy-timeout-edge-"));
const chargeStopAt = "2026-10-14T01:00:00.000Z";
let gets = 0;
let deletes = 0;
let quickFinal = false;

const server = createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer local-timeout-key") { res.writeHead(401).end(); return; }
  if (req.url !== "/openapi/v1/browser/sessions/timeout-session") { res.writeHead(404).end(); return; }
  if (!quickFinal) {
    const getDelays = [3_300, 3_300, 3_300, 4_800, 4_800, 4_800];
    await delay(req.method === "DELETE" ? 4_800 : getDelays[gets] ?? 4_800);
  }
  if (req.method === "DELETE") {
    deletes++;
    reply(res, 202, { session_id: "timeout-session", status: "stopping", charge_stop_at: chargeStopAt, billing: { status: "settling" } });
    return;
  }
  if (req.method === "GET") {
    gets++;
    const released = quickFinal || gets >= 4;
    const settled = quickFinal || gets >= 6;
    reply(res, 200, { session_id: "timeout-session", status: released ? "released" : "stopping", charge_stop_at: chargeStopAt, billing: { status: settled ? "settled" : "settling" } });
    return;
  }
  res.writeHead(405).end();
});

function reply(res: import("node:http").ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ code: "ok", data }));
}

function run(env: NodeJS.ProcessEnv): Promise<{ code: number; elapsedMs: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [agentBrowser, "plugin", "run", "capy", "capy.session.end", "--payload", JSON.stringify({ session: "timeout-edge" })], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (part) => stdout += part);
    child.stderr.setEncoding("utf8").on("data", (part) => stderr += part);
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, elapsedMs: Math.round(performance.now() - started), stdout, stderr }));
  });
}

let holder: Promise<unknown> | undefined;
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as import("node:net").AddressInfo).port;
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_") && !key.startsWith("CAPYBROWSER_"))) as NodeJS.ProcessEnv;
  Object.assign(environment, {
    CAPYBROWSER_BASE_URL: `http://127.0.0.1:${port}`,
    CAPYBROWSER_API_KEY: "local-timeout-key",
    CAPYBROWSER_STATE_DIR: join(scratch, "state"),
    CAPYBROWSER_REQUEST_TIMEOUT_MS: "5000",
    CAPYBROWSER_RELEASE_TIMEOUT_MS: "25000",
    CAPYBROWSER_SETTLEMENT_TIMEOUT_MS: "10000",
    CAPYBROWSER_POLL_INTERVAL_MS: "5000",
  });
  const config = readConfig(environment);
  const store = new StateStore(config.stateDir);
  const body = { purpose: "agent" } as const;
  const state = newTaskState("timeout-edge", body, bindingFor(config, body));
  state.sessionId = "timeout-session";
  state.phase = "ready";
  state.status = "ready";
  await store.withTask("timeout-edge", async (_saved, save) => save(state));

  let entered!: () => void;
  const acquired = new Promise<void>((resolve) => entered = resolve);
  holder = store.withTask("timeout-edge", async () => { entered(); await delay(9_000); });
  await acquired;
  const configFile = join(scratch, "agent-browser.json");
  await writeFile(configFile, JSON.stringify({ plugins: [{ name: "capy", command: installedProvider || process.execPath, args: installedProvider ? [] : [provider], capabilities: ["browser.provider", "command.run"] }] }), { mode: 0o600 });
  environment.AGENT_BROWSER_CONFIG = configFile;

  const first = await run(environment);
  assert.notEqual(first.code, 0, "slow end must remain incomplete");
  assert.ok(first.elapsedMs < 57_000, `plugin must return before the upstream 60-second kill: ${first.elapsedMs}ms`);
  assert.doesNotMatch(first.stdout + first.stderr, /Plugin 'capy' timed out/);
  assert.match(first.stdout + first.stderr, /facts_obtained=true.*stop_outcome=accepted.*accepted=true/);
  assert.match(first.stdout + first.stderr, /charge_stop_at=2026-10-14T01:00:00.000Z/);
  assert.match(first.stdout + first.stderr, /inspect.*retry/i);
  assert.equal(deletes, 1);
  await holder;

  quickFinal = true;
  const second = await run(environment);
  assert.equal(second.code, 0, second.stderr);
  const report = JSON.parse(second.stdout).data;
  assert.deepEqual([report.end_accepted, report.released, report.settled], [true, true, true]);
  assert.equal(deletes, 1, "retry after accepted DELETE must only query the same Session");
  console.log(JSON.stringify({ installedPackage: Boolean(installedProvider), firstExit: first.code, firstElapsedMs: first.elapsedMs, firstGets: gets - 1, firstStage: first.stderr.trim(), retryExit: second.code, deletes, finalBilling: report.billing_status }));
} finally {
  if (holder) await holder.catch(() => {});
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(scratch, { recursive: true, force: true });
}
