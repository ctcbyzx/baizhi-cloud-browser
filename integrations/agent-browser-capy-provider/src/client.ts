import type { CapyConfig, CreateBody, SessionProjection } from "./types.ts";
import { BudgetExpired, type RequestWindow } from "./budget.ts";

export class CapyApiError extends Error {
  readonly kind: "http" | "transport" | "invalid";
  readonly status?: number;

  constructor(kind: "http" | "transport" | "invalid", status?: number) {
    super(kind === "http" ? `Baizhi Cloud Browser API rejected the request (${status})` : "Baizhi Cloud Browser API request failed");
    this.name = "CapyApiError";
    this.kind = kind;
    this.status = status;
  }
}

export interface CapyApi {
  create(idempotencyKey: string, body: CreateBody): Promise<SessionProjection>;
  get(sessionId: string, window?: RequestWindow): Promise<SessionProjection>;
  control(sessionId: string): Promise<{ cdp_url: string; expires_at: string }>;
  stop(sessionId: string, window?: RequestWindow): Promise<SessionProjection>;
}

export class CapyClient implements CapyApi {
  private readonly config: CapyConfig;
  private readonly fetcher: typeof fetch;

  constructor(config: CapyConfig, fetcher: typeof fetch = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }

  create(idempotencyKey: string, body: CreateBody) {
    return this.request<SessionProjection>("POST", "/browser/sessions", body, { "Idempotency-Key": idempotencyKey }, [202]);
  }

  get(sessionId: string, window?: RequestWindow) {
    return this.request<SessionProjection>("GET", `/browser/sessions/${encodeURIComponent(sessionId)}`, undefined, {}, [200], window);
  }

  control(sessionId: string) {
    return this.request<{ cdp_url: string; expires_at: string }>("POST", `/browser/sessions/${encodeURIComponent(sessionId)}/control`, {});
  }

  stop(sessionId: string, window?: RequestWindow) {
    return this.request<SessionProjection>("DELETE", `/browser/sessions/${encodeURIComponent(sessionId)}`, undefined, {}, [200, 202], window);
  }

  private async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, accepted: number[] = [200], window?: RequestWindow): Promise<T> {
    const remaining = window?.remainingMs() ?? this.config.requestTimeoutMs;
    if (remaining <= 0 || window?.signal.aborted) throw new BudgetExpired();
    const timeout = Math.min(this.config.requestTimeoutMs, remaining);
    const requestSignal = AbortSignal.timeout(timeout);
    const signal = window ? AbortSignal.any([window.signal, requestSignal]) : requestSignal;
    try {
      const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
        method,
        redirect: "manual",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      if (!accepted.includes(response.status)) throw new CapyApiError("http", response.status);
      let parsed: { data?: T };
      try { parsed = await response.json() as { data?: T }; }
      catch (error) {
        if (signal.aborted) throw error;
        throw new CapyApiError("invalid");
      }
      if (!parsed || typeof parsed !== "object" || !parsed.data || typeof parsed.data !== "object") throw new CapyApiError("invalid");
      return parsed.data;
    } catch (error) {
      if (window && (window.remainingMs() <= 0 || window.signal.aborted)) throw new BudgetExpired();
      if (error instanceof CapyApiError) throw error;
      throw new CapyApiError("transport");
    }
  }
}
