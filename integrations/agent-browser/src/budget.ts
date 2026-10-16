import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

// agent-browser 0.38.2 kills plugin.run after 60 seconds. Keep ten seconds
// for state persistence, serialization, and CLI output after the last I/O.
export const END_COMMAND_BUDGET_MS = 50_000;

export class BudgetExpired extends Error {
  constructor() {
    super("Baizhi Cloud Browser end command time budget exhausted");
    this.name = "BudgetExpired";
  }
}

export interface RequestWindow {
  readonly signal: AbortSignal;
  remainingMs(): number;
}

export class EndBudget {
  private readonly expiresAt: number;
  private readonly controller = new AbortController();
  private readonly timer: NodeJS.Timeout;

  constructor(totalMs = END_COMMAND_BUDGET_MS) {
    this.expiresAt = performance.now() + totalMs;
    this.timer = setTimeout(() => this.controller.abort(new BudgetExpired()), totalMs);
  }

  remainingMs(stageExpiresAt = Infinity): number {
    return Math.max(0, Math.floor(Math.min(this.expiresAt, stageExpiresAt) - performance.now()));
  }

  expired(): boolean { return this.controller.signal.aborted || this.remainingMs() <= 0; }

  assertAvailable(stageExpiresAt = Infinity): void {
    if (this.remainingMs(stageExpiresAt) <= 0 || this.controller.signal.aborted) throw new BudgetExpired();
  }

  stage(milliseconds: number): number {
    return Math.min(this.expiresAt, performance.now() + milliseconds);
  }

  window(stageExpiresAt = Infinity): RequestWindow {
    return { signal: this.controller.signal, remainingMs: () => this.remainingMs(stageExpiresAt) };
  }

  async sleep(milliseconds: number, stageExpiresAt = Infinity): Promise<void> {
    this.assertAvailable(stageExpiresAt);
    const bounded = Math.min(milliseconds, this.remainingMs(stageExpiresAt));
    try { await delay(bounded, undefined, { signal: this.controller.signal }); }
    catch { throw new BudgetExpired(); }
    if (this.controller.signal.aborted) throw new BudgetExpired();
  }

  dispose(): void { clearTimeout(this.timer); }
}
