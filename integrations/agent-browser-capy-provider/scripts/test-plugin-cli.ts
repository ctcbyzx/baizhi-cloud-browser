import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readConfig } from "../src/config.ts";
import { StateStore, bindingFor, newTaskState } from "../src/state.ts";

const root = new URL("../", import.meta.url).pathname;
const installedProvider = process.env.CAPYBROWSER_TEST_INSTALLED_PROVIDER;
const provider = installedProvider || join(root, "dist", "plugin.js");
const sessionCommand = installedProvider ? join(dirname(installedProvider), "capy-agent-browser-session") : join(root, "dist", "cli.js");
const agentBrowser = join(root, "node_modules", "agent-browser", "bin", "agent-browser.js");
const scratch = await mkdtemp(join(tmpdir(), "capy-plugin-cli-"));
const modes = new Map<string, { status: string; billing: string }>();
const deletes = new Map<string, number>();
const chargeStopAt = "2026-10-14T00:01:00.000Z";

const server = createServer((req, res) => {
  if (req.headers.authorization !== "Bearer local-only-cli-key") {
    res.writeHead(401).end();
    return;
  }
  const match = (req.url ?? "").match(/^\/openapi\/v1\/browser\/sessions\/([^/]+)$/);
  if (!match) { res.writeHead(404).end(); return; }
  const id = decodeURIComponent(match[1]!);
  const mode = modes.get(id);
  if (!mode) { res.writeHead(404).end(); return; }
  if (req.method === "DELETE") {
    deletes.set(id, (deletes.get(id) ?? 0) + 1);
    reply(res, 202, { session_id: id, status: "stopping", billing: { status: "settling", charge_stop_at: chargeStopAt } });
    return;
  }
  if (req.method === "GET") {
    reply(res, 200, { session_id: id, status: mode.status, billing: { status: mode.billing, charge_stop_at: chargeStopAt } });
    return;
  }
  res.writeHead(405).end();
});

function reply(res: import("node:http").ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ code: "ok", message: "", data }));
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (part) => stdout += part);
    child.stderr.setEncoding("utf8").on("data", (part) => stderr += part);
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function pluginRun(type: string, task: string, env: NodeJS.ProcessEnv) {
  return run(process.execPath, [agentBrowser, "plugin", "run", "capy", type, "--payload", JSON.stringify({ session: task })], env);
}

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as import("node:net").AddressInfo).port;
  const configFile = join(scratch, "agent-browser.json");
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_") && !key.startsWith("CAPYBROWSER_"))) as NodeJS.ProcessEnv;
  Object.assign(environment, {
    AGENT_BROWSER_CONFIG: configFile,
    CAPYBROWSER_BASE_URL: `http://127.0.0.1:${port}`,
    CAPYBROWSER_API_KEY: "local-only-cli-key",
    CAPYBROWSER_STATE_DIR: join(scratch, "state"),
    CAPYBROWSER_POLL_INTERVAL_MS: "100",
    CAPYBROWSER_RELEASE_TIMEOUT_MS: "1000",
    CAPYBROWSER_SETTLEMENT_TIMEOUT_MS: "1000",
    CAPYBROWSER_REQUEST_TIMEOUT_MS: "1000",
  });
  await writeFile(configFile, JSON.stringify({ plugins: [{ name: "capy", command: installedProvider || process.execPath, args: installedProvider ? [] : [provider], capabilities: ["browser.provider", "command.run"] }] }), { mode: 0o600 });
  const config = readConfig(environment);
  const store = new StateStore(config.stateDir);
  const body = { purpose: "agent" } as const;
  async function seed(task: string, id: string, status: string, billing: string) {
    modes.set(id, { status, billing });
    const state = newTaskState(task, body, bindingFor(config, body));
    state.sessionId = id;
    state.phase = "ready";
    state.status = "ready";
    await store.withTask(task, async (_saved, save) => save(state));
  }

  const absent = await pluginRun("capy.session.end", "missing", environment);
  assert.notEqual(absent.code, 0, "no-state end must be a failed agent-browser command");
  assert.match(absent.stdout + absent.stderr, /accepted=false/);

  await seed("pending-release", "mock-pending-release", "stopping", "settling");
  const inspectedPending = await pluginRun("capy.session.inspect", "pending-release", environment);
  assert.equal(inspectedPending.code, 0);
  assert.equal(JSON.parse(inspectedPending.stdout).data.charge_stop_at, chargeStopAt);
  const pendingRelease = await pluginRun("capy.session.end", "pending-release", environment);
  assert.notEqual(pendingRelease.code, 0);
  assert.match(pendingRelease.stdout + pendingRelease.stderr, /release=stopping.*billing=settling/);
  assert.match(pendingRelease.stdout + pendingRelease.stderr, /charge_stop_at=2026-10-14T00:01:00.000Z/);
  const fullPending = await run(installedProvider ? sessionCommand : process.execPath, installedProvider ? ["end", "pending-release"] : [sessionCommand, "end", "pending-release"], environment);
  assert.equal(fullPending.code, 2);
  assert.equal(JSON.parse(fullPending.stdout).charge_stop_at, chargeStopAt);
  assert.equal(deletes.get("mock-pending-release"), 1, "accepted DELETE must not repeat while release is pending");

  await seed("waived", "mock-waived", "released", "waived");
  const waived = await pluginRun("capy.session.end", "waived", environment);
  assert.equal(waived.code, 0, waived.stderr);
  const waivedReport = JSON.parse(waived.stdout).data;
  assert.deepEqual([waivedReport.billing_final, waivedReport.settled, waivedReport.waived], [true, false, true]);

  await seed("review", "mock-review", "released", "review_required");
  const review = await pluginRun("capy.session.end", "review", environment);
  assert.notEqual(review.code, 0);
  assert.match(review.stdout + review.stderr, /review_required=true/);

  await seed("pending-billing", "mock-pending-billing", "released", "settling");
  const pendingBilling = await pluginRun("capy.session.end", "pending-billing", environment);
  assert.notEqual(pendingBilling.code, 0);
  assert.match(pendingBilling.stdout + pendingBilling.stderr, /release=released.*billing=settling/);
  modes.set("mock-pending-billing", { status: "released", billing: "settled" });
  const finished = await pluginRun("capy.session.end", "pending-billing", environment);
  assert.equal(finished.code, 0, finished.stderr);
  assert.equal(deletes.get("mock-pending-billing"), 1, "billing retry after release must not repeat DELETE");

  console.log(JSON.stringify({ installedPackage: Boolean(installedProvider), absentExit: absent.code, inspectChargeStopAt: true, pendingReleaseExit: pendingRelease.code, helperPendingExit: fullPending.code, waivedExit: waived.code, reviewExit: review.code, pendingBillingExit: pendingBilling.code, finalExit: finished.code, noRepeatDelete: true }));
} finally {
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(scratch, { recursive: true, force: true });
}
