import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const section = readme.split("## Retrieve a browser download\n")[1]?.split("\n## ")[0];
const example = section?.match(/```sh\n([\s\S]*?)\n```/)?.[1];
assert.ok(example, "README download example must exist");

const key = "local-download-fixture-key";
const content = Buffer.from("local Capy download fixture\n");
const digest = createHash("sha256").update(content).digest("hex");
const expectedPaths = [
  "/openapi/v1/browser/sessions/sess_.../downloads",
  "/openapi/v1/browser/sessions/sess_.../downloads/dl_.../content",
];
const requests = [];
const server = createServer((request, response) => {
  requests.push({ path: request.url, authorization: request.headers.authorization });
  if (request.headers.authorization !== `Bearer ${key}`) return response.writeHead(401).end();
  if (request.url === expectedPaths[0]) {
    return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ downloads: [{ id: "dl_...", state: "ready", size_bytes: content.length, sha256: digest }] }));
  }
  if (request.url === expectedPaths[1]) {
    return response.writeHead(200, { "content-length": content.length, "x-content-sha256": digest }).end(content);
  }
  response.writeHead(404).end();
});

async function shell(command, cwd, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (part) => stdout += part);
    child.stderr.setEncoding("utf8").on("data", (part) => stderr += part);
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const scratch = await mkdtemp(join(tmpdir(), "capy-readme-download-"));
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const mockAgent = join(scratch, "agent-browser");
  await writeFile(mockAgent, "#!/bin/sh\nexit 0\n");
  await chmod(mockAgent, 0o700);
  const env = { ...process.env, CAPYBROWSER_API_KEY: key, PATH: `${scratch}:${process.env.PATH}` };
  const variants = [
    `http://127.0.0.1:${port}`,
    `http://127.0.0.1:${port}/`,
    `http://127.0.0.1:${port}/openapi/v1`,
    `http://127.0.0.1:${port}/openapi/v1/`,
  ];
  for (const [index, base] of variants.entries()) {
    const cwd = join(scratch, String(index));
    await mkdir(cwd);
    requests.length = 0;
    const result = await shell(example, cwd, { ...env, CAPYBROWSER_BASE_URL: base });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(requests.map((request) => request.path), expectedPaths);
    assert.ok(requests.every((request) => request.authorization === `Bearer ${key}`));
    assert.deepEqual(await readFile(join(cwd, "capy-download.bin")), content);
  }
  const normalizer = example.slice(example.indexOf("CAPYBROWSER_API_ROOT="), example.indexOf("printf 'header"));
  for (const base of ["https://example.test", "https://example.test/", "https://example.test/openapi/v1", "https://example.test/openapi/v1/"]) {
    const result = await shell(`${normalizer}\nprintf '%s' "$CAPYBROWSER_API_ROOT"`, scratch, { ...env, CAPYBROWSER_BASE_URL: base });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "https://example.test/openapi/v1");
  }
  for (const base of ["http://remote.example", `http://user:pass@127.0.0.1:${port}`]) {
    requests.length = 0;
    const result = await shell(example, scratch, { ...env, CAPYBROWSER_BASE_URL: base });
    assert.notEqual(result.code, 0);
    assert.deepEqual(requests, []);
  }
  console.log(JSON.stringify({ localVariants: variants.length, httpsVariants: 4, paths: expectedPaths, rejectedUnsafeBases: 2 }));
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
