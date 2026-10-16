import { homedir } from "node:os";
import { join } from "node:path";
import type { CapyConfig } from "./types.ts";

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}

function normalizedBase(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid CAPYBROWSER_BASE_URL"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid CAPYBROWSER_BASE_URL");
  if (url.username || url.password) throw new Error("CAPYBROWSER_BASE_URL must not contain userinfo credentials");
  if (url.search || url.hash) throw new Error("CAPYBROWSER_BASE_URL must not contain a query or fragment");
  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    throw new Error("CAPYBROWSER_BASE_URL requires HTTPS except for explicit loopback HTTP fixtures");
  }
  let pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/openapi/v1")) pathname += "/openapi/v1";
  url.pathname = pathname;
  return url.toString().replace(/\/$/, "");
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname);
}

export function readConfig(env = process.env): CapyConfig {
  const rawBase = env.CAPYBROWSER_BASE_URL;
  const apiKey = env.CAPYBROWSER_API_KEY;
  if (!rawBase) throw new Error("CAPYBROWSER_BASE_URL is required");
  if (!apiKey) throw new Error("CAPYBROWSER_API_KEY is required");
  const profileId = env.CAPYBROWSER_PROFILE_ID?.trim() || undefined;
  const existingSessionId = env.CAPYBROWSER_SESSION_ID?.trim() || undefined;
  if (profileId && existingSessionId) throw new Error("Profile selection cannot be used with an existing Session");
  const maxSeconds = env.CAPYBROWSER_MAX_SECONDS === undefined
    ? undefined
    : positiveInt(env, "CAPYBROWSER_MAX_SECONDS", 900, 1, 7000);
  return {
    baseUrl: normalizedBase(rawBase),
    apiKey,
    stateDir: env.CAPYBROWSER_STATE_DIR || join(homedir(), ".capybrowser", "agent-browser-provider"),
    profileId,
    existingSessionId,
    maxSeconds,
    readyTimeoutMs: positiveInt(env, "CAPYBROWSER_READY_TIMEOUT_MS", 45_000, 1_000, 50_000),
    pollIntervalMs: positiveInt(env, "CAPYBROWSER_POLL_INTERVAL_MS", 750, 100, 5_000),
    requestTimeoutMs: positiveInt(env, "CAPYBROWSER_REQUEST_TIMEOUT_MS", 5_000, 500, 5_000),
    releaseTimeoutMs: positiveInt(env, "CAPYBROWSER_RELEASE_TIMEOUT_MS", 20_000, 1_000, 25_000),
    settlementTimeoutMs: positiveInt(env, "CAPYBROWSER_SETTLEMENT_TIMEOUT_MS", 10_000, 1_000, 10_000),
  };
}

export function taskKeyFromRequest(request: unknown): string {
  const value = (request as { session?: unknown } | null)?.session;
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new Error("agent-browser supplied an invalid task session");
  }
  return value;
}
