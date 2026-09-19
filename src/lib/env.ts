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
