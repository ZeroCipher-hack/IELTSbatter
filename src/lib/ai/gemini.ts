import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/lib/env";
import { buildWritingGradingPrompt, WRITING_GRADING_PROMPT_VERSION } from "./prompts";
import { extractJson } from "./json";
import {
  writingGradingResponseSchema,
  type AIGrader,
  type WritingGradingInput,
  type WritingGradingResult,
} from "./schema";
import { computeOverall } from "@/lib/utils/scoring";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 2;

export class GeminiGrader implements AIGrader {
  readonly provider = "gemini";
  readonly model: string;
  private client: GoogleGenerativeAI;

  constructor() {
    this.model = env.geminiModel;
    this.client = new GoogleGenerativeAI(env.geminiApiKey);
  }

  async gradeWriting(input: WritingGradingInput): Promise<WritingGradingResult> {
    const prompt = buildWritingGradingPrompt({
      question: input.question,
      essay: input.essay,
      feedbackLocale: input.feedbackLocale,
    });

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const started = Date.now();
      try {
        const raw = await this.callModel(prompt);
        const parsed = extractJson(raw);
        const data = writingGradingResponseSchema.parse(parsed);
        return {
          data,
          overall: computeOverall({
            taskResponse: data.scores.taskResponse.band,
            coherenceCohesion: data.scores.coherenceCohesion.band,
            lexicalResource: data.scores.lexicalResource.band,
            grammar: data.scores.grammar.band,
          }),
          meta: {
            provider: this.provider,
            model: this.model,
            promptVersion: WRITING_GRADING_PROMPT_VERSION,
            rawResponse: raw,
            latencyMs: Date.now() - started,
          },
        };
      } catch (error) {
        lastError = error;
        // Log for developers without leaking secrets.
        console.error(
          `[ai] gemini grading attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
          error instanceof Error ? error.message : "unknown error"
        );
      }
    }

    throw new AIGradingError("AI grading failed after retries", lastError);
  }

  private async callModel(prompt: string): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const result = await withTimeout(
      model.generateContent(prompt),
      REQUEST_TIMEOUT_MS,
      "Gemini request timed out"
    );
    return result.response.text();
  }
}

export class AIGradingError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AIGradingError";
    this.cause = cause;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
