import { CapyApiError, CapyClient, type CapyApi } from "./client.ts";
import { StateLockUnavailable, StateStore, bindingFor, hashKey, newTaskState } from "./state.ts";
import { BudgetExpired, EndBudget } from "./budget.ts";
import type { CapyConfig, CreateBody, Phase, ProviderLaunch, SessionProjection, TaskState } from "./types.ts";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class Lifecycle {
  private readonly config: CapyConfig;
  private readonly store: StateStore;
  private readonly client: CapyApi;
  private readonly wait: (ms: number) => Promise<void>;

  constructor(
    config: CapyConfig,
    store: StateStore,
    client: CapyApi = new CapyClient(config),
    wait: (ms: number) => Promise<void> = sleep,
  ) {
    this.config = config;
    this.store = store;
    this.client = client;
    this.wait = wait;
  }

  async launch(taskKey: string): Promise<ProviderLaunch> {
    const body = this.launchBody();

    return this.store.withTask(taskKey, async (saved, save) => {
      let state = saved;
      if (!state) {
        state = newTaskState(taskKey, body, bindingFor(this.config, body), this.config.existingSessionId);
        await save(state);
      }
      this.assertOwnershipAndSession(state, taskKey, body);
      if (state.phase === "ending" || state.phase === "released" || state.phase === "failed") {
        throw new Error("This task's Baizhi Cloud Browser Session is ending or ended; do not create a replacement automatically");
      }
      if (!state.sessionId) await this.createOrRecover(state, save);
      const sessionId = state.sessionId;
      if (!sessionId) throw new Error("Baizhi Cloud Browser create outcome is still unknown; retry this same agent-browser session");

      const session = await this.waitUntilReady(sessionId, state, save);
      state.status = session.status;
      state.phase = "ready";
      await save(state);

      const grant = await this.controlSameSession(sessionId);
      assertOneTimeCdpUrl(grant.cdp_url);
      // The URL is deliberately returned only through the provider protocol. It is
      // never written to disk or included in diagnostics.
      return {
        cdpUrl: grant.cdp_url,
        cleanup: { sessionId: taskKey },
        metadata: { ownership: state.ownership },
      };
    });
  }

  /**
   * agent-browser v0.38.2 sends the same browser.close request for explicit close,
   * failed CDP attach, and implicit relaunch after a dead connection. The callback
   * therefore only acknowledges detach; it must not stop a Capy Session.
   */
  async acknowledgeDetach(_taskKey: string): Promise<void> {}

  async end(taskKey: string, confirmExisting = false, providedBudget?: EndBudget): Promise<EndReport> {
    const budget = providedBudget ?? new EndBudget();
    let observed: TaskState | undefined;
    let factsObtained = false;
    let stopUnknown = false;
    try {
      return await this.store.withTask(taskKey, async (state, save) => {
        factsObtained = true;
        observed = state;
        if (state) this.assertOwnershipAndSession(state, taskKey, this.launchBody());
        if (!state?.sessionId) return this.endReport(state, true, false, budget.expired());
        if (state.ownership === "existing" && !confirmExisting) {
          throw new Error("This Session is user-owned; pass --confirm-existing only when you explicitly own its stop");
        }

        const wasReleased = state.phase === "released";
        if (!wasReleased) {
          state.phase = "ending";
          await save(state);
        }
        if (!state.endAcceptedAt && !wasReleased) {
          try {
            budget.assertAvailable();
            // DELETE is idempotent, but an aborted response leaves its outcome unknown.
            const stopped = await this.client.stop(state.sessionId, budget.window());
            recordProjection(state, stopped);
            state.endAcceptedAt = new Date().toISOString();
            await save(state);
          } catch (error) {
            if (!(error instanceof BudgetExpired) && !(error instanceof CapyApiError)) throw error;
            stopUnknown = true;
            return this.endReport(state, true, true, budget.expired());
          }
        }

        const releaseUntil = budget.stage(this.config.releaseTimeoutMs);
        while (budget.remainingMs(releaseUntil) > 0) {
          let latest: SessionProjection;
          try { latest = await this.client.get(state.sessionId, budget.window(releaseUntil)); }
          catch (error) {
            if (!(error instanceof BudgetExpired) && !(error instanceof CapyApiError)) throw error;
            break;
          }
          recordProjection(state, latest);
          if (latest.status === "released") state.phase = "released";
          else if (latest.status === "failed") state.phase = "failed";
          await save(state);
          if (latest.status === "released" || latest.status === "failed" || latest.status === "ending_review_required") break;
          try { await budget.sleep(this.config.pollIntervalMs, releaseUntil); }
          catch (error) { if (error instanceof BudgetExpired) break; throw error; }
        }

        if (state.status === "released" && !isBillingFinal(state.billingStatus) && state.billingStatus !== "review_required") {
          const settlementUntil = budget.stage(this.config.settlementTimeoutMs);
          while (budget.remainingMs(settlementUntil) > 0 && !isBillingFinal(state.billingStatus) && state.billingStatus !== "review_required") {
            try { await budget.sleep(this.config.pollIntervalMs, settlementUntil); }
            catch (error) { if (error instanceof BudgetExpired) break; throw error; }
            if (budget.remainingMs(settlementUntil) <= 0) break;
            let latest: SessionProjection;
            try { latest = await this.client.get(state.sessionId, budget.window(settlementUntil)); }
            catch (error) {
              if (!(error instanceof BudgetExpired) && !(error instanceof CapyApiError)) throw error;
              break;
            }
            recordProjection(state, latest);
            await save(state);
          }
        }
        return this.endReport(state, true, stopUnknown, budget.expired());
      }, budget);
    } catch (error) {
      if (error instanceof BudgetExpired || error instanceof StateLockUnavailable || budget.expired()) {
        return this.endReport(observed, factsObtained, stopUnknown, budget.expired());
      }
      throw error;
    } finally {
      if (!providedBudget) budget.dispose();
    }
  }

  private endReport(state: TaskState | undefined, factsObtained: boolean, stopUnknown: boolean, budgetExhausted: boolean): EndReport {
    const releaseStatus = factsObtained ? state?.status ?? "unknown" : "unknown";
    const billingStatus = factsObtained ? state?.billingStatus ?? "unknown" : "unknown";
    const released = releaseStatus === "released";
    const billingFinal = isBillingFinal(billingStatus);
    const reviewRequired = billingStatus === "review_required" || releaseStatus === "ending_review_required";
    const stopOutcome = !factsObtained ? "unknown" : state?.endAcceptedAt ? "accepted" : stopUnknown || state?.phase === "ending" ? "unknown" : "not_requested";
    let nextAction: string | null;
    if (!factsObtained) nextAction = "State lock unavailable; no Session facts were read. Retry capy.session.inspect and capy.session.end with the same task name";
    else if (!state?.sessionId) nextAction = "Check the task name with capy.session.inspect; no saved Session can be ended";
    else if (reviewRequired) nextAction = "Inspect the Session and resolve the Baizhi Cloud Browser review requirement; retry after its status changes";
    else if (stopOutcome === "unknown") nextAction = "DELETE outcome is unknown; inspect the Session, then retry capy.session.end with the same task name";
    else if (!state.endAcceptedAt) nextAction = "Inspect the Session in Baizhi Cloud Browser; DELETE acceptance was not recorded. If it expired, confirm expiry there";
    else if (!released || !billingFinal) nextAction = "Run capy.session.inspect, then retry capy.session.end with the same task name; pending settlement does not imply ongoing usage charges";
    else nextAction = null;
    if (budgetExhausted && nextAction) nextAction = `Time budget exhausted. ${nextAction}`;
    return {
      session_id: factsObtained ? state?.sessionId ?? null : null,
      facts_obtained: factsObtained,
      stop_outcome: stopOutcome,
      budget_exhausted: budgetExhausted,
      end_accepted: !factsObtained || stopOutcome === "unknown" ? null : Boolean(state?.endAcceptedAt),
      end_accepted_at: state?.endAcceptedAt ?? null,
      release_status: releaseStatus,
      released: factsObtained ? released : null,
      released_at: state?.releasedAt ?? null,
      billing_status: billingStatus,
      billing_final: factsObtained ? billingFinal : null,
      actual_charge_centipoints: state?.actualChargeCentipoints ?? null,
      settled: factsObtained ? billingStatus === "settled" : null,
      waived: factsObtained ? billingStatus === "waived" : null,
      review_required: factsObtained ? reviewRequired : null,
      charge_stop_at: state?.chargeStopAt ?? null,
      expires_at: state?.expiresAt ?? null,
      next_action: nextAction,
    };
  }

  async inspect(taskKey: string): Promise<SessionProjection | null> {
    return this.store.withTask(taskKey, async (state, save) => {
      if (state) this.assertOwnershipAndSession(state, taskKey, this.launchBody());
      if (!state?.sessionId) return null;
      const latest = await this.client.get(state.sessionId);
      recordProjection(state, latest);
      await save(state);
      const knownChargeStopAt = state.chargeStopAt;
      return knownChargeStopAt ? { ...latest, billing: { ...latest.billing, charge_stop_at: knownChargeStopAt } } : latest;
    });
  }

  private launchBody(): CreateBody {
    const body: CreateBody = { purpose: "agent" };
    if (this.config.profileId) body.profile_id = this.config.profileId;
    if (this.config.maxSeconds !== undefined) body.max_seconds = this.config.maxSeconds;
    return body;
  }

  private assertOwnershipAndSession(state: TaskState, taskKey: string, body: CreateBody) {
    if (state.schema !== 2 || state.taskKeyHash !== hashKey(taskKey) || !state.binding) {
      throw new Error("Stored Session state is unbound or invalid; keep it for manual Baizhi Cloud Browser inspection");
    }
    const expected = bindingFor(this.config, body);
    if (state.binding.endpoint !== expected.endpoint ||
        state.binding.credentialFingerprint !== expected.credentialFingerprint ||
        JSON.stringify(state.binding.launchBody) !== JSON.stringify(expected.launchBody) ||
        (state.ownership === "created" && JSON.stringify(state.createBody) !== JSON.stringify(body))) {
      throw new Error("Saved Session configuration changed; restore the original CAPYBROWSER_* settings, then run capy.session.inspect or capy.session.end");
    }
    if (state.ownership === "existing" && this.config.existingSessionId !== state.sessionId) {
      throw new Error("CAPYBROWSER_SESSION_ID no longer matches this task's saved Session");
    }
    if (state.ownership === "created" && this.config.existingSessionId) {
      throw new Error("This task already owns a created Session; remove CAPYBROWSER_SESSION_ID to resume it");
    }
    if (!state.taskKeyHash || !taskKey) throw new Error("Invalid task identity");
  }

  private async createOrRecover(state: TaskState, save: (next: TaskState) => Promise<void>) {
    if (state.ownership !== "created" || !state.idempotencyKey || !state.createBody) {
      throw new Error("Create state is incomplete; refusing a new Session");
    }
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const session = await this.client.create(state.idempotencyKey, state.createBody);
        if (!session.session_id) throw new Error("Baizhi Cloud Browser create response omitted Session ID");
        state.sessionId = session.session_id;
        recordProjection(state, session);
        await save(state);
        return;
      } catch (error) {
        last = error;
        if (attempt === 1 || !retrySameCreate(error)) break;
        await this.wait(200);
      }
    }
    if (last instanceof CapyApiError) {
      if (last.kind === "http") throw new Error(`Baizhi Cloud Browser create was rejected (${last.status}); the saved idempotency key is retained`);
      throw new Error("Baizhi Cloud Browser create result is unknown; retry using the same agent-browser session");
    }
    throw new Error("Baizhi Cloud Browser create response was invalid; the saved idempotency key is retained");
  }

  private async waitUntilReady(sessionId: string, state: TaskState, save: (next: TaskState) => Promise<void>) {
    const deadline = Date.now() + this.config.readyTimeoutMs;
    let last: SessionProjection | undefined;
    do {
      last = await this.client.get(sessionId);
      recordProjection(state, last);
      await save(state);
      if (last.status === "ready") return last;
      if (last.status === "released" || last.status === "failed" || last.status === "ending_review_required" || last.status === "stopping") {
        state.phase = last.status === "failed" ? "failed" : last.status === "released" ? "released" : "ending";
        await save(state);
        throw new Error(`Baizhi Cloud Browser Session is ${last.status}; refusing to replace it`);
      }
      if (Date.now() >= deadline) break;
      await this.wait(this.config.pollIntervalMs);
    } while (Date.now() < deadline);
    throw new Error("Baizhi Cloud Browser Session did not become ready before the bounded startup deadline");
  }

  private async controlSameSession(sessionId: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await this.client.control(sessionId); }
      catch (error) {
        if (attempt === 1 || !retrySameControl(error)) throw new Error("Baizhi Cloud Browser control grant failed; retry this same task Session");
        await this.wait(200);
      }
    }
    throw new Error("Baizhi Cloud Browser control grant failed");
  }
}

export interface EndReport {
  session_id: string | null;
  facts_obtained: boolean;
  stop_outcome: "accepted" | "unknown" | "not_requested";
  budget_exhausted: boolean;
  end_accepted: boolean | null;
  end_accepted_at?: string | null;
  release_status: string;
  released: boolean | null;
  released_at?: string | null;
  billing_status: string;
  billing_final: boolean | null;
  actual_charge_centipoints?: number | null;
  settled: boolean | null;
  waived: boolean | null;
  review_required: boolean | null;
  charge_stop_at: string | null;
  expires_at: string | null;
  next_action: string | null;
}

function retrySameCreate(error: unknown): boolean {
  return error instanceof CapyApiError && (error.kind === "transport" || (error.kind === "http" && (error.status ?? 0) >= 500));
}

function retrySameControl(error: unknown): boolean {
  return error instanceof CapyApiError && (error.kind === "transport" || (error.kind === "http" && (error.status ?? 0) >= 500));
}

function recordProjection(state: TaskState, session: SessionProjection) {
  if (state.sessionId && state.sessionId !== session.session_id) throw new Error("Baizhi Cloud Browser returned a different Session ID for this task");
  state.sessionId = session.session_id;
  state.status = session.status;
  state.billingStatus = session.billing?.status ?? state.billingStatus;
  const chargeStopAt = session.billing?.charge_stop_at ?? session.charge_stop_at;
  if (chargeStopAt != null) state.chargeStopAt = chargeStopAt;
  if (session.expires_at !== undefined) state.expiresAt = session.expires_at;
  if (session.billing?.actual_charge_centipoints !== undefined) state.actualChargeCentipoints = session.billing.actual_charge_centipoints;
  if (session.status === "released") state.releasedAt = session.ended_at || state.releasedAt || new Date().toISOString();
}

function isBillingFinal(status?: string) {
  return status === "settled" || status === "waived";
}

function assertOneTimeCdpUrl(value: string) {
  try {
    const url = new URL(value);
    if ((url.protocol !== "wss:" && url.protocol !== "ws:") || !url.hostname) throw new Error();
  } catch {
    throw new Error("Baizhi Cloud Browser returned an unusable CDP control address");
  }
}
