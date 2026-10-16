import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { BudgetExpired, type EndBudget } from "./budget.ts";
import type { CapyConfig, CreateBody, TaskBinding, TaskState } from "./types.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class StateLockUnavailable extends Error {
  constructor() { super("State lock unavailable; no Session facts were read"); }
}
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function bindingFor(config: CapyConfig, launchBody: CreateBody): TaskBinding {
  return {
    endpoint: config.baseUrl,
    credentialFingerprint: createHash("sha256").update("capy-agent-browser-credential-v1\0").update(config.apiKey).digest("hex"),
    launchBody,
  };
}

export class StateStore {
  readonly dir: string;
  private readonly openLockFile: (path: string) => Promise<FileHandle>;

  constructor(dir: string, openLockFile: (path: string) => Promise<FileHandle> = (path) => open(path, "wx", 0o600)) {
    this.dir = dir;
    this.openLockFile = openLockFile;
  }

  private paths(key: string) {
    const id = hashKey(key);
    return { state: join(this.dir, `${id}.json`), lock: join(this.dir, `${id}.lock`) };
  }

  async withTask<T>(key: string, fn: (state: TaskState | undefined, save: (next: TaskState) => Promise<void>) => Promise<T>, budget?: EndBudget): Promise<T> {
    budget?.assertAvailable();
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    budget?.assertAvailable();
    const { state: statePath, lock: lockPath } = this.paths(key);
    const lock = await this.lock(lockPath, budget);
    try {
      budget?.assertAvailable();
      let current: TaskState | undefined;
      try { current = JSON.parse(await readFile(statePath, "utf8")) as TaskState; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Session state is unreadable"); }
      budget?.assertAvailable();
      const save = async (next: TaskState) => {
        next.updatedAt = new Date().toISOString();
        const tmp = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await writeFile(tmp, JSON.stringify(next), { mode: 0o600, flag: "wx" });
          await rename(tmp, statePath);
        } finally {
          await rm(tmp, { force: true });
        }
        await chmodFile(statePath);
        current = next;
      };
      return await fn(current, save);
    } finally {
      let owned: Awaited<ReturnType<FileHandle["stat"]>>;
      try { owned = await lock.stat(); }
      finally { await lock.close(); }
      try {
        const current = await stat(lockPath);
        if (current.dev === owned.dev && current.ino === owned.ino) await rm(lockPath, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private async lock(path: string, budget?: EndBudget) {
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      budget?.assertAvailable();
      let file: Awaited<ReturnType<typeof open>>;
      try {
        file = await this.openLockFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await this.removeDeadLock(path)) continue;
        if (budget) await budget.sleep(Math.min(25, Math.max(1, deadline - performance.now())));
        else await sleep(25);
        continue;
      }
      try {
        await file.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
        return file;
      } catch (error) {
        const owned = await file.stat().catch(() => null);
        await file.close();
        if (owned) {
          const current = await stat(path).catch(() => null);
          if (current && current.dev === owned.dev && current.ino === owned.ino) await rm(path, { force: true });
        }
        throw error;
      }
    }
    if (budget?.expired()) throw new BudgetExpired();
    throw new StateLockUnavailable();
  }

  private async removeDeadLock(path: string): Promise<boolean> {
    const guard = `${path}.reaper`;
    try { await mkdir(guard); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        if (await this.removeAbandonedReaper(guard)) return this.removeDeadLock(path);
        return false;
      }
      throw error;
    }
    try {
      await writeFile(join(guard, "owner"), JSON.stringify({ pid: process.pid, at: Date.now() }), { mode: 0o600, flag: "wx" });
      const [raw, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
      let lock: { pid?: number; at?: number } | undefined;
      try { lock = JSON.parse(raw) as { pid?: number; at?: number }; } catch {}
      if (Date.now() - info.mtimeMs < 30_000) return false;
      if (lock?.pid && isPidAlive(lock.pid)) return false;
      const current = await stat(path);
      if (current.dev !== info.dev || current.ino !== info.ino || current.mtimeMs !== info.mtimeMs || current.size !== info.size) return false;
      if (await readFile(path, "utf8") !== raw) return false;
      await rm(path, { force: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    } finally {
      await rm(guard, { recursive: true, force: true });
    }
  }

  private async removeAbandonedReaper(guard: string): Promise<boolean> {
    try {
      const info = await stat(guard);
      if (Date.now() - info.mtimeMs < 30_000) return false;
      let owner: { pid?: number } | undefined;
      try { owner = JSON.parse(await readFile(join(guard, "owner"), "utf8")) as { pid?: number }; } catch {}
      if (owner?.pid && isPidAlive(owner.pid)) return false;
      const current = await stat(guard);
      if (current.dev !== info.dev || current.ino !== info.ino || current.mtimeMs !== info.mtimeMs) return false;
      await rm(guard, { recursive: true, force: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
  }
}

export function newTaskState(taskKey: string, body: CreateBody, binding: TaskBinding, existingSessionId?: string): TaskState {
  return {
    schema: 2,
    taskKeyHash: hashKey(taskKey),
    binding,
    ownership: existingSessionId ? "existing" : "created",
    sessionId: existingSessionId,
    idempotencyKey: existingSessionId ? undefined : randomUUID().replaceAll("-", ""),
    createBody: existingSessionId ? undefined : body,
    phase: existingSessionId ? "ready" : "creating",
    updatedAt: new Date().toISOString(),
  };
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

async function chmodFile(path: string) {
  const file = await open(path, "r+");
  try { await file.chmod(0o600); } finally { await file.close(); }
}
