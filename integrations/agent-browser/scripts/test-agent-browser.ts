import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const root = new URL("../", import.meta.url).pathname;
const providerPath = process.env.CAPYBROWSER_TEST_INSTALLED_PROVIDER || join(root, "dist", "plugin.js");
const cliPath = join(root, "node_modules", "agent-browser", "bin", "agent-browser.js");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const fakeApiKey = "local-mock-key-only";

interface RunResult { code: number; stdout: string; stderr: string }
interface Session { session_id: string; status: string; billing: { status: string; actual_charge_centipoints: number | null; charge_stop_at?: string }; ended_at?: string }

const scratch = await mkdtemp(join(tmpdir(), "capy-agent-browser-live-"));
const socketDir = join(tmpdir(), `ab-${process.pid}`);
const eventFile = join(scratch, "plugin-events.jsonl");
let chrome: ChildProcess | undefined;
let apiServer: Server | undefined;
let pageServer: Server | undefined;
let proxyServer: Server | undefined;
const sessionNameA = "capy-owned-a";
const sessionNameB = "capy-fail-b";
const sessions = new Map<string, Session>();
const idempotency = new Map<string, { body: unknown; session: Session }>();
const creates: Array<{ key: string; body: unknown; id: string }> = [];
const controls: Array<{ id: string; lease: string }> = [];
const pluginEvents: Array<{ type: string; session: string }> = [];
const deletes: string[] = [];
let pageUrl = "";
let validWsUrl = "";
let proxyPort = 0;
let chromePort = 0;
let leaseNumber = 0;
let probeCount = 0;
const usedLeases = new Set<string>();
const connections = new Set<{ destroy: () => void }>();
const duplicateLeaseAttempts: string[] = [];
const failedSessionId = "mock-session-b";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as import("node:net").AddressInfo).port;
}

function reply(res: ServerResponse, status: number, data: unknown, code = "ok") {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ code, message: "", data, request_id: "mock-request" }));
}

async function bodyJson(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function startMockApi() {
  apiServer = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${fakeApiKey}`) return reply(res, 401, null, "unauthorized");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "POST" && url.pathname === "/openapi/v1/browser/sessions") {
      const key = req.headers["idempotency-key"];
      const body = await bodyJson(req);
      if (!key || typeof body !== "object") return reply(res, 400, null, "invalid_request");
      const prior = idempotency.get(key);
      if (prior) {
        if (JSON.stringify(prior.body) !== JSON.stringify(body)) return reply(res, 409, null, "idempotency_conflict");
        return reply(res, 202, prior.session);
      }
      const id = creates.length === 0 ? "mock-session-a" : failedSessionId;
      const session: Session = { session_id: id, status: "starting", billing: { status: "reserved", actual_charge_centipoints: null } };
      sessions.set(id, session);
      idempotency.set(key, { body, session });
      creates.push({ key, body, id });
      return reply(res, 202, session);
    }
    const controlMatch = url.pathname.match(/^\/openapi\/v1\/browser\/sessions\/([^/]+)\/control$/);
    if (req.method === "POST" && controlMatch) {
      const id = decodeURIComponent(controlMatch[1]!);
      const session = sessions.get(id);
      if (!session) return reply(res, 404, null, "not_found");
      if (session.status === "starting") session.status = "ready";
      if (session.status !== "ready") return reply(res, 409, null, "not_ready");
      const lease = `lease-${++leaseNumber}`;
      controls.push({ id, lease });
      const cdpUrl = id === failedSessionId
        ? `ws://127.0.0.1:1/devtools/browser/no-such-browser?lease=${lease}`
        : `${validWsUrl}?lease=${lease}`;
      return reply(res, 200, { cdp_url: cdpUrl, expires_at: new Date(Date.now() + 60_000).toISOString() });
    }
    const sessionMatch = url.pathname.match(/^\/openapi\/v1\/browser\/sessions\/([^/]+)$/);
    if (req.method === "GET" && sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]!);
      const session = sessions.get(id);
      if (!session) return reply(res, 404, null, "not_found");
      const idem = [...idempotency.values()].find((x) => x.session.session_id === id);
      if (idem) session.status = session.status === "starting" ? "ready" : session.status;
      if (deletes.includes(id)) {
        const stopPolls = (session as Session & { polls?: number }).polls = ((session as Session & { polls?: number }).polls ?? 0) + 1;
        session.status = stopPolls < 2 ? "stopping" : "released";
        session.ended_at = session.status === "released" ? "2026-10-14T00:00:00.000Z" : undefined;
        session.billing = stopPolls < 3 ? { status: "settling", actual_charge_centipoints: null, charge_stop_at: "2026-10-14T00:00:00.000Z" } : { status: "settled", actual_charge_centipoints: 125, charge_stop_at: "2026-10-14T00:00:00.000Z" };
      }
      return reply(res, 200, session);
    }
    if (req.method === "DELETE" && sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]!);
      const session = sessions.get(id);
      if (!session) return reply(res, 404, null, "not_found");
      if (!deletes.includes(id)) deletes.push(id);
      session.status = "stopping";
      session.billing.charge_stop_at = "2026-10-14T00:00:00.000Z";
      return reply(res, 202, session);
    }
    return reply(res, 404, null, "not_found");
  });
  const port = await listen(apiServer);
  return `http://127.0.0.1:${port}`;
}

async function startPage() {
  pageServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Capy local provider test</title><h1>local CDP fixture</h1>");
  });
  const port = await listen(pageServer);
  pageUrl = `http://127.0.0.1:${port}`;
}

async function startChrome() {
  chrome = spawn(chromePath, [
    "--headless=new", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    `--user-data-dir=${join(scratch, "chrome-profile")}`, "about:blank",
  ], { stdio: "ignore" });
  const activeFile = join(scratch, "chrome-profile", "DevToolsActivePort");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const [portText] = (await readFile(activeFile, "utf8")).trim().split("\n");
      chromePort = Number(portText);
      const response = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
      const version = await response.json() as { webSocketDebuggerUrl?: string };
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    } catch {}
    if (chrome.exitCode !== null) throw new Error("Local Chrome exited before exposing CDP");
    await delay(100);
  }
  throw new Error("Local Chrome did not expose CDP before the startup deadline");
}

async function startOneTimeProxy(upstreamUrl: string) {
  const upstream = new URL(upstreamUrl);
  proxyServer = createServer((_req, res) => {
    probeCount++;
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Discovery is not available on one-time URLs");
  });
  proxyServer.on("upgrade", (req, client, head) => {
    const incoming = new URL(req.url ?? "/", "http://localhost");
    const lease = incoming.searchParams.get("lease") ?? "missing";
    if (usedLeases.has(lease)) {
      duplicateLeaseAttempts.push(lease);
      client.end("HTTP/1.1 410 Gone\r\nConnection: close\r\n\r\n");
      return;
    }
    usedLeases.add(lease);
    const serverSocket = connect(chromePort, "127.0.0.1");
    connections.add(client);
    connections.add(serverSocket);
    const forget = () => { connections.delete(client); connections.delete(serverSocket); };
    client.on("close", forget);
    serverSocket.on("close", forget);
    serverSocket.on("connect", () => {
      const lines: string[] = [`GET ${upstream.pathname}${upstream.search} HTTP/1.1`];
      const raw = req.rawHeaders;
      for (let i = 0; i < raw.length; i += 2) {
        const name = raw[i]!;
        const value = name.toLowerCase() === "host" ? `127.0.0.1:${chromePort}` : raw[i + 1]!;
        lines.push(`${name}: ${value}`);
      }
      serverSocket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) serverSocket.write(head);
      client.pipe(serverSocket);
      serverSocket.pipe(client);
    });
    serverSocket.on("error", () => client.destroy());
    client.on("error", () => serverSocket.destroy());
  });
  proxyPort = await listen(proxyServer);
  validWsUrl = `ws://127.0.0.1:${proxyPort}${upstream.pathname}${upstream.search}`;
  return () => { for (const socket of connections) socket.destroy(); };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => stdout += chunk);
    child.stderr.setEncoding("utf8").on("data", (chunk) => stderr += chunk);
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function agentArgs(task: string, ...args: string[]) {
  return ["--session", task, "--provider", "capy", ...args];
}

const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_") && !key.startsWith("CAPYBROWSER_"))) as NodeJS.ProcessEnv;

try {
  assert.ok(await exists(chromePath), "Google Chrome must be installed locally for the real CDP acceptance");
  const apiBase = await startMockApi();
  await startPage();
  const chromeWs = await startChrome();
  const dropActiveConnections = await startOneTimeProxy(chromeWs);

  const configFile = join(scratch, "agent-browser.json");
  // agent-browser encodes the task name into a Unix socket path with a hard
  // platform limit. Use a short, per-process temporary path to avoid the
  // long macOS mkdtemp prefix consuming that budget.
  const wrapperFile = join(scratch, "provider-wrapper.mjs");
  await (await import("node:fs/promises")).mkdir(socketDir, { recursive: true, mode: 0o700 });
  await writeFile(wrapperFile, `#!/usr/bin/env node\nimport { spawn } from 'node:child_process';\nimport { appendFileSync } from 'node:fs';\nlet raw=''; for await (const chunk of process.stdin) raw += chunk;\nconst message=JSON.parse(raw);\nconst request=message.request ?? {};\nconst session=message.type==='browser.close' ? request.sessionId : request.session;\nappendFileSync(process.env.CAPYBROWSER_TEST_EVENTS, JSON.stringify({type:message.type,session:String(session ?? '')})+'\\n');\nconst child=spawn(process.execPath,['--experimental-strip-types',process.env.CAPYBROWSER_PLUGIN_ENTRY],{stdio:['pipe','pipe','inherit']});\nlet output=''; child.stdout.setEncoding('utf8').on('data',chunk=>output+=chunk); child.on('error',()=>process.exit(1)); child.on('close',code=>{process.stdout.write(output);process.exit(code ?? 1)}); child.stdin.end(raw);\n`, { mode: 0o700 });
  await writeFile(configFile, JSON.stringify({ plugins: [{ name: "capy", command: process.execPath, args: [wrapperFile], capabilities: ["browser.provider", "command.run"] }] }), { mode: 0o600 });
  Object.assign(environment, {
    AGENT_BROWSER_CONFIG: configFile,
    AGENT_BROWSER_SOCKET_DIR: socketDir,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: "0",
    CAPYBROWSER_BASE_URL: apiBase,
    CAPYBROWSER_API_KEY: fakeApiKey,
    CAPYBROWSER_STATE_DIR: join(scratch, "adapter-state"),
    CAPYBROWSER_PLUGIN_ENTRY: providerPath,
    CAPYBROWSER_TEST_EVENTS: eventFile,
    CAPYBROWSER_POLL_INTERVAL_MS: "100",
    CAPYBROWSER_READY_TIMEOUT_MS: "8000",
    CAPYBROWSER_RELEASE_TIMEOUT_MS: "5000",
    CAPYBROWSER_SETTLEMENT_TIMEOUT_MS: "5000",
  });

  const opened = await run(process.execPath, [cliPath, ...agentArgs(sessionNameA, "open", pageUrl)], environment);
  assert.equal(opened.code, 0, `real agent-browser provider open failed: ${opened.stderr}`);
  const title = await run(process.execPath, [cliPath, ...agentArgs(sessionNameA, "get", "title")], environment);
  assert.equal(title.code, 0, `real agent-browser get title failed: ${title.stderr}`);
  assert.match(title.stdout, /Capy local provider test/);
  assert.equal(creates.length, 1);
  assert.equal(controls.filter((x) => x.id === "mock-session-a").length, 1);
  assert.equal(probeCount, 0, "agent-browser must not probe a full one-time WebSocket CDP URL before attach");

  // Break the actual CDP socket. The next explicit launch must use the same
  // Session and request a fresh lease, without a create or an implicit stop.
  dropActiveConnections();
  await delay(150);
  const relaunched = await run(process.execPath, [cliPath, ...agentArgs(sessionNameA, "open", pageUrl)], environment);
  assert.equal(relaunched.code, 0, `same-Session relaunch failed: ${relaunched.stderr}`);
  assert.equal(creates.length, 1, "disconnect recovery must not create a replacement Session");
  assert.equal(controls.filter((x) => x.id === "mock-session-a").length, 2, "recovery must request a fresh control lease");
  assert.deepEqual(deletes, [], "browser.close during implicit relaunch must not stop Capy");
  assert.equal(duplicateLeaseAttempts.length, 0, "each lease URL may be used only once");

  const closeA = await run(process.execPath, [cliPath, ...agentArgs(sessionNameA, "close")], environment);
  assert.equal(closeA.code, 0, `agent-browser close failed: ${closeA.stderr}`);
  assert.deepEqual(deletes, [], "agent-browser close is only a detach; explicit Capy end is separate");

  // A second real provider call uses another agent-browser session and gets a
  // different Capy Session. Its deliberately bad CDP address exercises attach failure.
  const failed = await run(process.execPath, [cliPath, ...agentArgs(sessionNameB, "open", pageUrl)], environment);
  assert.notEqual(failed.code, 0, "the deliberately unreachable CDP address should fail");
  assert.equal(creates.length, 2);
  assert.notEqual(creates[0]?.id, creates[1]?.id);
  assert.deepEqual(deletes, [], "browser.close on failed attach must not guess that the paid Session can be ended");
  assert.ok(sessions.get(failedSessionId)?.status === "ready", "failed attach leaves a known Session requiring explicit cleanup");
  const eventLines = (await readFile(eventFile, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string; session: string });
  pluginEvents.push(...eventLines);
  assert.ok(pluginEvents.some((event) => event.type === "browser.close" && event.session === sessionNameA), "agent-browser close callback should identify the task cleanup payload");
  assert.ok(pluginEvents.some((event) => event.type === "browser.close" && event.session === sessionNameB), "failed CDP attach should invoke the same provider close callback");

  const endB = await run(process.execPath, [cliPath, "plugin", "run", "capy", "capy.session.end", "--payload", JSON.stringify({ session: sessionNameB })], environment);
  assert.equal(endB.code, 0, `explicit failed-attach cleanup failed: ${endB.stderr}`);
  const reopenA = await run(process.execPath, [cliPath, ...agentArgs(sessionNameA, "open", pageUrl)], environment);
  assert.equal(reopenA.code, 0, `reopen before end failed: ${reopenA.stderr}`);
  const endA = await run(process.execPath, [cliPath, "plugin", "run", "capy", "capy.session.end", "--payload", JSON.stringify({ session: sessionNameA })], environment);
  assert.equal(endA.code, 0, `explicit Session end failed: ${endA.stderr}`);
  const beforePostEndClose = (await readFile(eventFile, "utf8")).trim().split("\n").length;
  dropActiveConnections();
  await delay(150);
  const postEndClose = await run(process.execPath, [cliPath, ...agentArgs(sessionNameA, "close")], environment);
  assert.notEqual(postEndClose.code, 0, "close after release and CDP loss must not relaunch a terminal Capy task");
  assert.match(postEndClose.stdout + postEndClose.stderr, /success=false/);
  const postEndEventTypes = (await readFile(eventFile, "utf8")).trim().split("\n").slice(beforePostEndClose).map((line) => (JSON.parse(line) as { type: string }).type);
  assert.deepEqual(postEndEventTypes, ["browser.close", "browser.launch"], "upstream relaunch after lost CDP must not create a new Capy Session");
  const reportA = (JSON.parse(endA.stdout) as { data: { end_accepted: boolean; released: boolean; settled: boolean; charge_stop_at: string | null } }).data;
  assert.deepEqual([reportA.end_accepted, reportA.released, reportA.settled], [true, true, true]);
  assert.equal(reportA.charge_stop_at, "2026-10-14T00:00:00.000Z");
  assert.equal(deletes.length, 2);
  assert.equal(creates.length, 2, "post-end close must not create a replacement Session");
  assert.ok(duplicateLeaseAttempts.length === 0);
  assert.ok(!JSON.stringify({ stdout: opened.stdout, stderr: opened.stderr, stdout2: title.stdout, stderr2: title.stderr }).includes(fakeApiKey));
  console.log(JSON.stringify({
    realAgentBrowser: "0.38.2",
    localChrome: true,
    sessionsCreated: creates.length,
    reconnectSameSession: creates.length === 2 && controls.filter((x) => x.id === "mock-session-a").length >= 2,
    duplicateLeaseAttempts: duplicateLeaseAttempts.length,
    discoveryProbes: probeCount,
    explicitEnd: reportA,
    closeCallbackEvents: pluginEvents.filter((event) => event.type === "browser.close").length,
    postEndCloseExit: postEndClose.code,
    postEndEventTypes,
  }, null, 2));
} finally {
  for (const socket of connections) socket.destroy();
  if (chrome && chrome.exitCode === null) chrome.kill("SIGTERM");
  for (const server of [apiServer, pageServer, proxyServer]) {
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const name of await readdir(socketDir).catch(() => [])) {
    if (!name.endsWith(".pid")) continue;
    const pid = Number((await readFile(join(socketDir, name), "utf8")).trim());
    if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, "SIGTERM"); } catch {} }
  }
  await rm(socketDir, { recursive: true, force: true });
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await rm(scratch, { recursive: true, force: true }); break; }
    catch (error) {
      if (attempt === 9 || (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
      await delay(200);
    }
  }
}

async function exists(path: string) {
  try { await access(path); return true; } catch { return false; }
}
