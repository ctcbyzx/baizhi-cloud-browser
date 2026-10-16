export type Ownership = "created" | "existing";
export type Phase = "creating" | "ready" | "ending" | "released" | "failed" | "unknown";

export interface CreateBody {
  purpose: "agent";
  profile_id?: string;
  max_seconds?: number;
}

export interface TaskBinding {
  endpoint: string;
  credentialFingerprint: string;
  launchBody: CreateBody;
}

export interface TaskState {
  schema: 2;
  taskKeyHash: string;
  binding: TaskBinding;
  ownership: Ownership;
  sessionId?: string;
  idempotencyKey?: string;
  createBody?: CreateBody;
  phase: Phase;
  status?: string;
  endAcceptedAt?: string;
  releasedAt?: string;
  billingStatus?: string;
  chargeStopAt?: string | null;
  expiresAt?: string | null;
  actualChargeCentipoints?: number | null;
  updatedAt: string;
}

export interface SessionProjection {
  session_id: string;
  status: string;
  profile_id?: string | null;
  ended_at?: string | null;
  charge_stop_at?: string | null;
  expires_at?: string | null;
  billing?: {
    status?: string;
    charge_stop_at?: string | null;
    actual_charge_centipoints?: number | null;
  };
}

export interface CapyConfig {
  baseUrl: string;
  apiKey: string;
  stateDir: string;
  profileId?: string;
  existingSessionId?: string;
  maxSeconds?: number;
  readyTimeoutMs: number;
  pollIntervalMs: number;
  requestTimeoutMs: number;
  releaseTimeoutMs: number;
  settlementTimeoutMs: number;
}

export interface ProviderLaunch {
  cdpUrl: string;
  cleanup: { sessionId: string };
  metadata: { ownership: Ownership };
}
