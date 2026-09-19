/**
 * Central, typed access to environment variables.
 * Never import this from client components — server only.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export const env = {
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  get sessionSecret(): string {
    return required("SESSION_SECRET");
  },
  /** "gemini" | "mock" */
  get aiMode(): string {
    return process.env.AI_MODE ?? (process.env.GEMINI_API_KEY ? "gemini" : "mock");
  },
  get geminiApiKey(): string {
    return required("GEMINI_API_KEY");
  },
  get geminiModel(): string {
    return process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  },
  /** Max Gemini request attempts per grading (1 = no retry). Never infinite. */
  get geminiMaxAttempts(): number {
    return positiveInt(process.env.GEMINI_MAX_ATTEMPTS, 3);
  },
  /** Timeout for a single Gemini request, in milliseconds. */
  get geminiTimeoutMs(): number {
    return positiveInt(process.env.GEMINI_TIMEOUT_MS, 60_000);
  },
  /** Base delay for exponential backoff between retries (ms). */
  get geminiRetryBaseMs(): number {
    return positiveInt(process.env.GEMINI_RETRY_BASE_MS, 800);
  },
  /**
   * Which grading prompt to use: "V1" | "V2" (default V2).
   * Kept in env so V1 and V2 results can be compared over time.
   */
  get aiPromptVersion(): "V1" | "V2" {
    const raw = (process.env.AI_PROMPT_VERSION ?? "V2").toUpperCase().replace(/^WRITING_GRADING_PROMPT_/, "");
    return raw === "V1" ? "V1" : "V2";
  },
  /**
   * Expose AI diagnostics (model, prompt version, retries, latency).
   * HARD RULE: never in production — not even if AI_DEBUG=true leaks into the
   * production environment via a copied .env file.
   */
  get aiDebug(): boolean {
    if (process.env.NODE_ENV === "production") return false;
    if (process.env.AI_DEBUG === "true") return true;
    if (process.env.AI_DEBUG === "false") return false;
    return true;
  },
  /** "mock" | "live" */
  get smsMode(): string {
    return process.env.SMS_MODE ?? "mock";
  },
  /** "mock" | "click" | "payme" */
  get paymentMode(): string {
    return process.env.PAYMENT_MODE ?? "mock";
  },
  get writingMinWords(): number {
    return Number(process.env.WRITING_MIN_WORDS ?? 250);
  },
  get writingEnforceMinWords(): boolean {
    return process.env.WRITING_ENFORCE_MIN_WORDS === "true";
  },
};
