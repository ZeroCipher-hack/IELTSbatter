import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/lib/env";
import {
  promptVersionFromLabel,
  buildWritingGradingPromptForVersion,
  type WritingPromptVersion,
} from "./prompts";
import { extractJson } from "./json";
import { finalizeGradingResult } from "./result";
import { sanitizeAiText } from "./sanitize";
import {
  writingGradingResponseSchema,
  type AIGrader,
  type ValidationStatus,
  type WritingGradingInput,
  type WritingGradingResult,
} from "./schema";

/** Hard ceiling for a single Gemini HTTP call. */
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_MS = 800;
const MAX_RETRY_DELAY_MS = 8_000;
/** Cap on stored raw provider text (keeps DB rows reasonable). */
const MAX_RAW_CHARS = 100_000;
const MAX_ERROR_RAW_CHARS = 4_000;

/** What one provider call returns. Injectable so tests never hit the network. */
export interface GeminiCallResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface GeminiTransport {
  generate(prompt: string): Promise<GeminiCallResult>;
}

export interface GeminiGraderOptions {
  model?: string;
  promptVersion?: WritingPromptVersion;
  transport?: GeminiTransport;
  maxAttempts?: number;
  timeoutMs?: number;
  retryBaseMs?: number;
  /** Injectable sleep (tests use a no-op to skip real waiting). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source in [0, 1). */
  random?: () => number;
  /** Called before each backoff wait — used for retry logging/tests. */
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
}

/**
 * Gemini-backed grader.
 *
 * Reliability contract:
 *  - one HTTP call per attempt, with a hard timeout;
 *  - bounded retries (never infinite) with exponential backoff + jitter;
 *  - transient failures (429/5xx/network/timeout) and invalid model output are
 *    retried; configuration failures (400/401/403/404) fail fast;
 *  - every raw response, attempt count, validation status, latency and (when
 *    reported) token usage is returned in meta for persistence;
 *  - error messages are sanitized — API keys never reach logs or responses.
 */
export class GeminiGrader implements AIGrader {
  readonly provider = "gemini";
  readonly model: string;
  readonly promptVersion: WritingPromptVersion;

  private readonly transport: GeminiTransport;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly retryBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly onRetry?: GeminiGraderOptions["onRetry"];

  constructor(options: GeminiGraderOptions = {}) {
    this.model = options.model ?? env.geminiModel;
    this.promptVersion =
      options.promptVersion ?? promptVersionFromLabel(env.aiPromptVersion);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? env.geminiMaxAttempts);
    this.timeoutMs = options.timeoutMs ?? env.geminiTimeoutMs;
    this.retryBaseMs = options.retryBaseMs ?? env.geminiRetryBaseMs;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
    this.onRetry = options.onRetry;
    this.transport = options.transport ?? new SdkGeminiTransport(this.model, this.timeoutMs);
  }

  async gradeWriting(input: WritingGradingInput): Promise<WritingGradingResult> {
    const prompt = buildWritingGradingPromptForVersion(this.promptVersion, {
      question: input.question,
      essay: input.essay,
      feedbackLocale: input.feedbackLocale,
    });

    const startedAt = Date.now();
    let attempts = 0;
    let lastRaw = "";
    let lastValidationErrors: string[] = [];
    let lastStatus: ValidationStatus = "PROVIDER_ERROR";
    let lastReason = "unknown error";
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;

    while (attempts < this.maxAttempts) {
      attempts++;
      try {
        const call = await this.transport.generate(prompt);
        lastRaw = truncate(call.text ?? "", MAX_RAW_CHARS);
        if (call.inputTokens != null) inputTokens = call.inputTokens;
        if (call.outputTokens != null) outputTokens = call.outputTokens;

        const data = parseAndValidate(lastRaw);
        return finalizeGradingResult({
          data,
          meta: {
            provider: this.provider,
            model: this.model,
            promptVersion: this.promptVersion,
            rawResponse: lastRaw,
            latencyMs: Date.now() - startedAt,
            attempts,
            retryCount: attempts - 1,
            validationStatus: "VALID",
            validationErrors: [],
            inputTokens,
            outputTokens,
          },
        });
      } catch (error) {
        const failure = classifyFailure(error);
        lastStatus = failure.status;
        lastValidationErrors = failure.validationErrors;
        lastReason = failure.message;
        if (failure.raw != null) lastRaw = truncate(failure.raw, MAX_RAW_CHARS);

        console.error(
          `[ai] gemini grading attempt ${attempts}/${this.maxAttempts} failed (${lastStatus}): ${lastReason}`
        );

        const hasBudget = attempts < this.maxAttempts;
        if (!failure.retryable || !hasBudget) break;

        const delay = this.backoffDelay(attempts);
        this.onRetry?.({ attempt: attempts, delayMs: delay, reason: lastReason });
        await this.sleep(delay);
      }
    }

    throw new AIGradingError({
      provider: this.provider,
      model: this.model,
      promptVersion: this.promptVersion,
      attempts,
      retryCount: attempts - 1,
      latencyMs: Date.now() - startedAt,
      validationStatus: lastStatus,
      validationErrors: lastValidationErrors,
      rawResponse: truncate(lastRaw, MAX_ERROR_RAW_CHARS),
      reason: lastReason,
    });
  }

  /** Exponential backoff with ±20% jitter, capped — bounded by maxAttempts. */
  private backoffDelay(attempt: number): number {
    const base = Math.min(this.retryBaseMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
    const jitter = 0.8 + 0.4 * this.random();
    return Math.round(base * jitter);
  }
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export interface AIGradingErrorDetails {
  provider: string;
  model: string;
  promptVersion: string;
  attempts: number;
  retryCount: number;
  latencyMs: number;
  validationStatus: ValidationStatus;
  validationErrors: string[];
  /** Raw provider text from the last attempt (truncated, sanitized on read). */
  rawResponse: string;
  /** Secret-free description of what went wrong. */
  reason: string;
}

/** Thrown when grading could not be completed after the retry budget. */
export class AIGradingError extends Error {
  readonly details: AIGradingErrorDetails;

  constructor(details: AIGradingErrorDetails) {
    super(`AI grading failed (${details.validationStatus}) after ${details.attempts} attempt(s)`);
    this.name = "AIGradingError";
    this.details = details;
  }
}

/* ------------------------------------------------------------------ *
 * Parsing / validation
 * ------------------------------------------------------------------ */

function parseAndValidate(raw: string) {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (error) {
    throw new OutputFailure("INVALID_JSON", [
      error instanceof Error ? error.message : "Response was not valid JSON",
    ]);
  }

  const result = writingGradingResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new OutputFailure(
      "SCHEMA_MISMATCH",
      result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    );
  }
  return result.data;
}

/** Internal marker for "the model answered, but the answer was unusable". */
class OutputFailure extends Error {
  readonly status: ValidationStatus;
  readonly validationErrors: string[];
  constructor(status: ValidationStatus, validationErrors: string[]) {
    super(validationErrors[0] ?? "invalid model output");
    this.name = "OutputFailure";
    this.status = status;
    this.validationErrors = validationErrors;
  }
}

interface FailureInfo {
  retryable: boolean;
  status: ValidationStatus;
  message: string;
  validationErrors: string[];
  raw: string | null;
}

function classifyFailure(error: unknown): FailureInfo {
  if (error instanceof OutputFailure) {
    return {
      // Model-side formatting problems are worth one more (better) sample.
      retryable: true,
      status: error.status,
      message: sanitizeAiText(error.message),
      validationErrors: error.validationErrors.map(sanitizeAiText),
      raw: null,
    };
  }

  const status = httpStatusOf(error);
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = sanitizeAiText(rawMessage);

  if (status != null) {
    const retryable = status === 429 || status === 408 || status >= 500;
    return {
      retryable,
      status: "PROVIDER_ERROR",
      message: `provider responded ${status}: ${message}`,
      validationErrors: [],
      raw: null,
    };
  }

  if (isTimeout(error)) {
    return {
      retryable: true,
      status: "PROVIDER_ERROR",
      message: `request timed out: ${message}`,
      validationErrors: [],
      raw: null,
    };
  }

  if (isNetworkError(rawMessage)) {
    return {
      retryable: true,
      status: "PROVIDER_ERROR",
      message: `network error: ${message}`,
      validationErrors: [],
      raw: null,
    };
  }

  // Unknown failures: one retry is reasonable, the budget still bounds it.
  return {
    retryable: true,
    status: "PROVIDER_ERROR",
    message,
    validationErrors: [],
    raw: null,
  };
}

function httpStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: unknown };
  return typeof candidate.status === "number" ? candidate.status : undefined;
}

function isTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("aborted") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isNetworkError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("fetch failed") ||
    m.includes("network") ||
    m.includes("econnreset") ||
    m.includes("enotfound") ||
    m.includes("eai_again") ||
    m.includes("socket hang up") ||
    m.includes("etimedout")
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated]`;
}

/* ------------------------------------------------------------------ *
 * Default transport — the only place the SDK/API key is touched
 * ------------------------------------------------------------------ */

class SdkGeminiTransport implements GeminiTransport {
  private readonly client: GoogleGenerativeAI;

  constructor(
    private readonly model: string,
    private readonly timeoutMs: number
  ) {
    this.client = new GoogleGenerativeAI(env.geminiApiKey);
  }

  async generate(prompt: string): Promise<GeminiCallResult> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(prompt, { timeout: this.timeoutMs });
    const usage = result.response.usageMetadata;

    return {
      text: result.response.text(),
      inputTokens: usage?.promptTokenCount ?? null,
      outputTokens: usage?.candidatesTokenCount ?? null,
    };
  }
}
