/**
 * AI grading entry point.
 *
 * The rest of the application ONLY imports from this file (and schema.ts) —
 * never from gemini.ts directly — so the provider can be swapped by editing
 * this factory alone.
 */
import { env } from "@/lib/env";
import type { AIGrader } from "./schema";
import { GeminiGrader } from "./gemini";
import { MockGrader } from "./mock";

let cached: AIGrader | undefined;

export function getGrader(): AIGrader {
  if (!cached) {
    cached = env.aiMode === "gemini" ? new GeminiGrader() : new MockGrader();
  }
  return cached;
}

/** For tests: inject a custom grader. */
export function setGraderForTesting(grader: AIGrader | undefined): void {
  cached = grader;
}

export { AIGradingError } from "./gemini";
export type { AIGradingErrorDetails, GeminiTransport, GeminiCallResult } from "./gemini";
export {
  buildAiDebugInfo,
  debugInfoForResponse,
  logAiDebug,
  type AIDebugInfo,
} from "./debug";
export type {
  AIGrader,
  GradingMeta,
  ValidationStatus,
  WritingGradingInput,
  WritingGradingResult,
  WritingGradingResponse,
} from "./schema";
