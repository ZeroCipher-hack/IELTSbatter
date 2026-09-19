/**
 * Gemini-backed speaking providers.
 *
 * Reliability contract (mirrors the writing grader):
 *  - one HTTP call per attempt with a hard timeout;
 *  - bounded retries with exponential backoff + jitter (never infinite);
 *  - transient failures and unusable model output are retried, configuration
 *    failures (400/401/403/404) fail fast;
 *  - the API key is only ever read inside this class and is never logged,
 *    returned or stored;
 *  - raw model text is returned in meta so the pipeline can persist it
 *    server-side only.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/lib/env";

import { extractJson } from "../json";
import { sanitizeAiText } from "../sanitize";
import { finalizeSpeakingResult } from "./result";
import {
  SPEAKING_GRADING_PROMPT_V1,
  buildSpeakingGradingPrompt,
  speakingEvaluationSchema,
  SpeakingGradingError,
  type SpeakingEvaluationResponse,
  type SpeakingGradingInput,
  type SpeakingGradingMeta,
  type SpeakingGradingResult,
  type SpeakingGrader,
  type TranscriptionInput,
  type TranscriptionProvider,
  type TranscriptionResult,
} from "./types";

const MAX_RETRY_DELAY_MS = 8_000;
const MAX_RAW_CHARS = 100_000;
/** Gemini accepts inline audio up to roughly 20 MB; stay well below it. */
export const MAX_INLINE_AUDIO_BYTES = 15 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * Transcription
 * ------------------------------------------------------------------ */

export interface GeminiAudioTransport {
  transcribe(params: {
    model: string;
    prompt: string;
    mimeType: string;
    /** base64-encoded audio */
    data: string;
    timeoutMs: number;
  }): Promise<{ text: string }>;
}

export interface GeminiTranscriptionOptions {
  model?: string;
  transport?: GeminiAudioTransport;
  timeoutMs?: number;
}

const TRANSCRIPTION_PROMPT =
  "Transcribe the spoken English in this audio recording verbatim. " +
  "Do not translate, do not summarise, do not add commentary, and do not fix the speaker's grammar. " +
  "If the audio contains no intelligible speech, reply with the single word: EMPTY.";

export class GeminiTranscriptionProvider implements TranscriptionProvider {
  readonly name = "gemini";
  readonly model: string;
  readonly isMock = false;

  private readonly transport: GeminiAudioTransport;
  private readonly timeoutMs: number;

  constructor(options: GeminiTranscriptionOptions = {}) {
    this.model = options.model ?? env.geminiModel;
    this.timeoutMs = options.timeoutMs ?? env.geminiTimeoutMs;
    this.transport = options.transport ?? new SdkGeminiAudioTransport();
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const startedAt = Date.now();
    if (input.audio.length > MAX_INLINE_AUDIO_BYTES) {
      throw new Error(
        `audio_too_large_for_inline_transcription:${input.audio.length}>${MAX_INLINE_AUDIO_BYTES}`
      );
    }

    const { text } = await this.transport.transcribe({
      model: this.model,
      prompt: TRANSCRIPTION_PROMPT,
      mimeType: input.mimeType,
      data: input.audio.toString("base64"),
      timeoutMs: this.timeoutMs,
    });

    const transcript = (text ?? "").trim();
    return {
      transcript,
      provider: this.name,
      model: this.model,
      isMock: false,
      latencyMs: Date.now() - startedAt,
      raw: transcript.slice(0, MAX_RAW_CHARS),
      empty: transcript.length === 0 || transcript.toUpperCase() === "EMPTY",
    };
  }
}

/* ------------------------------------------------------------------ *
 * Evaluation
 * ------------------------------------------------------------------ */

export interface GeminiSpeakingTransport {
  generate(prompt: string): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }>;
}

export interface GeminiSpeakingGraderOptions {
  model?: string;
  transport?: GeminiSpeakingTransport;
  maxAttempts?: number;
  timeoutMs?: number;
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class GeminiSpeakingGrader implements SpeakingGrader {
  readonly provider = "gemini";
  readonly model: string;
  readonly promptVersion = SPEAKING_GRADING_PROMPT_V1;
  readonly isMock = false;

  private readonly transport: GeminiSpeakingTransport;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: GeminiSpeakingGraderOptions = {}) {
    this.model = options.model ?? env.geminiModel;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? env.geminiMaxAttempts);
    this.retryBaseMs = options.retryBaseMs ?? env.geminiRetryBaseMs;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.transport =
      options.transport ?? new SdkGeminiSpeakingTransport(this.model, options.timeoutMs ?? env.geminiTimeoutMs);
  }

  async gradeSpeaking(input: SpeakingGradingInput): Promise<SpeakingGradingResult> {
    const prompt = buildSpeakingGradingPrompt({
      question: input.question,
      transcript: input.transcript,
      part: input.part ?? null,
      feedbackLocale: input.feedbackLocale,
    });

    const startedAt = Date.now();
    let attempts = 0;
    let lastMeta: SpeakingGradingMeta = baseMeta(this, "PROVIDER_ERROR");
    let lastReason = "unknown error";

    while (attempts < this.maxAttempts) {
      attempts += 1;
      try {
        const call = await this.transport.generate(prompt);
        const raw = truncate(call.text ?? "", MAX_RAW_CHARS);

        let parsed: unknown;
        try {
          parsed = extractJson(raw);
        } catch (error) {
          throw new OutputFailure("INVALID_JSON", [
            error instanceof Error ? sanitizeAiText(error.message) : "Response was not valid JSON",
          ]);
        }

        const result = speakingEvaluationSchema.safeParse(parsed);
        if (!result.success) {
          throw new OutputFailure(
            "SCHEMA_MISMATCH",
            result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
          );
        }

        return finalizeSpeakingResult({
          data: result.data as SpeakingEvaluationResponse,
          meta: {
            provider: this.provider,
            model: this.model,
            promptVersion: this.promptVersion,
            isMock: false,
            latencyMs: Date.now() - startedAt,
            attempts,
            retryCount: attempts - 1,
            validationStatus: "VALID",
            validationErrors: [],
            rawResponse: raw,
            inputTokens: call.inputTokens,
            outputTokens: call.outputTokens,
          },
        });
      } catch (error) {
        const failure = classifyFailure(error);
        lastReason = failure.message;
        lastMeta = {
          ...baseMeta(this, failure.status),
          latencyMs: Date.now() - startedAt,
          attempts,
          retryCount: attempts - 1,
          validationErrors: failure.validationErrors,
          rawResponse: failure.raw ? truncate(failure.raw, MAX_RAW_CHARS) : null,
        };

        console.error(
          `[ai] gemini speaking grading attempt ${attempts}/${this.maxAttempts} failed (${failure.status}): ${lastReason}`
        );

        if (!failure.retryable || attempts >= this.maxAttempts) break;

        const delay = this.backoffDelay(attempts);
        await this.sleep(delay);
      }
    }

    throw new SpeakingGradingError({ ...lastMeta, reason: lastReason });
  }

  /** Exponential backoff with ±20% jitter, capped and bounded by maxAttempts. */
  private backoffDelay(attempt: number): number {
    const base = Math.min(this.retryBaseMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
    const jitter = 0.8 + 0.4 * this.random();
    return Math.round(base * jitter);
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function baseMeta(grader: SpeakingGrader, status: SpeakingGradingMeta["validationStatus"]): SpeakingGradingMeta {
  return {
    provider: grader.provider,
    model: grader.model,
    promptVersion: grader.promptVersion,
    isMock: grader.isMock,
    latencyMs: 0,
    attempts: 0,
    retryCount: 0,
    validationStatus: status,
    validationErrors: [],
    rawResponse: null,
    inputTokens: null,
    outputTokens: null,
  };
}

class OutputFailure extends Error {
  readonly status: SpeakingGradingMeta["validationStatus"];
  readonly validationErrors: string[];

  constructor(status: SpeakingGradingMeta["validationStatus"], validationErrors: string[]) {
    super(validationErrors[0] ?? "invalid model output");
    this.name = "OutputFailure";
    this.status = status;
    this.validationErrors = validationErrors;
  }
}

interface FailureInfo {
  retryable: boolean;
  status: SpeakingGradingMeta["validationStatus"];
  message: string;
  validationErrors: string[];
  raw: string | null;
}

function classifyFailure(error: unknown): FailureInfo {
  if (error instanceof OutputFailure) {
    return {
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
    return {
      retryable: status === 429 || status === 408 || status >= 500,
      status: "PROVIDER_ERROR",
      message: `provider responded ${status}: ${message}`,
      validationErrors: [],
      raw: null,
    };
  }

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

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated]`;
}

/* ------------------------------------------------------------------ *
 * Default transports — the only place the SDK/API key is touched
 * ------------------------------------------------------------------ */

class SdkGeminiSpeakingTransport implements GeminiSpeakingTransport {
  private readonly client: GoogleGenerativeAI;

  constructor(
    private readonly model: string,
    private readonly timeoutMs: number
  ) {
    this.client = new GoogleGenerativeAI(env.geminiApiKey);
  }

  async generate(prompt: string) {
    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
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

class SdkGeminiAudioTransport implements GeminiAudioTransport {
  private readonly client: GoogleGenerativeAI;

  constructor() {
    this.client = new GoogleGenerativeAI(env.geminiApiKey);
  }

  async transcribe(params: {
    model: string;
    prompt: string;
    mimeType: string;
    data: string;
    timeoutMs: number;
  }) {
    const model = this.client.getGenerativeModel({ model: params.model });
    const result = await model.generateContent(
      {
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: params.mimeType, data: params.data } },
              { text: params.prompt },
            ],
          },
        ],
      },
      { timeout: params.timeoutMs }
    );
    return { text: result.response.text() };
  }
}
