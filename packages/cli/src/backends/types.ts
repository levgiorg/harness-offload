import type { Task } from "../assets.ts";

export const E = {
  USAGE: 2,
  QUOTA: 10,
  AUTH: 11,
  TIMEOUT: 12,
  MODEL: 13,
  WORKER: 14,
  MISSING: 15,
  REFUSED: 16,
} as const;

export class WorkerError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

export interface WorkerRequest {
  task: Task;
  system: string;
  prompt: string;
  /** Backend-specific model id; "" = the backend's own default. */
  model: string;
  variant?: string;
  /** Working directory: the project for explore, an empty work dir otherwise. */
  cwd: string;
  timeoutSec: number;
  /** explore only: how many tool steps the worker may take. */
  maxSteps?: number;
  /** Secret globs the explorer must never read. */
  secretGlobs?: string[];
  allowGlobs?: string[];
}

export interface WorkerResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** Prompt size of the final step ≈ context the worker had to hold. */
  ctxIn: number;
  cost: number;
}

export interface Backend {
  /** Connector id, e.g. "opencode", "openai", "pi". */
  readonly kind: string;
  /** Human label for doctor/setup. */
  readonly label: string;
  available(): Promise<{ ok: boolean; detail: string }>;
  run(req: WorkerRequest): Promise<WorkerResult>;
  /** Optional: list model ids the backend can use. */
  models?(): Promise<string[]>;
}

/** Maps an error string to an exit code (same rules as the bash engine). */
export function classify(message: string): number {
  const m = message.toLowerCase();
  if (/provider\.(rate-limit|quota|free-limit|go-limit|overloaded)|usage limit|rate limit|rate_limit|quota|too many requests|\b429\b|overloaded|limit reached|insufficient|credit/.test(m)) return E.QUOTA;
  if (/provider\.auth|api key|api_key|unauthori[sz]ed|\b401\b|\b403\b|forbidden|not authenticated|log ?in|authenticat|auth type|auth method|security token|invalid token|token expired|expired token|no providers? configured/.test(m)) return E.AUTH;
  if (/provider\.no-route|model unavailable|model not found|unknown model|provider not found|providermodelnotfound|model_not_found|does not exist/.test(m)) return E.MODEL;
  if (/provider\.timeout|timed out/.test(m)) return E.TIMEOUT;
  return E.WORKER;
}
