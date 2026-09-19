import type { GradingMeta, WritingGradingResponse } from "./schema";

/**
 * Non-fatal observations about one grading run.
 *
 * Warnings never change the scores the user sees; they mark data that an
 * operator should look at (model disagreeing with the platform's overall
 * computation, a truncated raw response, an under-length essay). They are
 * stored on `AiEvaluation.warnings` for later analysis.
 */
export const GRADING_WARNINGS = {
  /** The model's informational "overall" differs from the backend-computed one. */
  overallMismatch: "AI_OVERALL_MISMATCH",
  /** Raw provider text exceeded the storage cap and was truncated. */
  rawTruncated: "RAW_RESPONSE_TRUNCATED",
  /** The essay is shorter than the configured minimum word count. */
  underlength: "ESSAY_UNDER_MIN_WORDS",
  /** Very few words were reported by the provider usage metadata (cost signal). */
  lowOutputTokens: "LOW_OUTPUT_TOKENS",
} as const;

export type GradingWarning = (typeof GRADING_WARNINGS)[keyof typeof GRADING_WARNINGS];

export interface WarningInput {
  data: WritingGradingResponse;
  /** Backend-computed overall band. */
  overall: number;
  rawResponse: string;
  /** Word count of the graded essay. */
  wordCount: number;
  minWords: number;
  rawTruncated?: boolean;
  outputTokens?: number | null;
}

/** Band difference at which a model/backend overall disagreement is reported. */
export const OVERALL_MISMATCH_THRESHOLD = 1.0;
/** Output token count below which a response looks suspiciously thin. */
export const LOW_OUTPUT_TOKENS_THRESHOLD = 50;

/**
 * Provider-level warnings: facts the AI layer knows while calling the model.
 * Every provider (Gemini today, anything else tomorrow) reports these.
 */
export function computeProviderWarnings(input: {
  rawTruncated?: boolean;
  outputTokens?: number | null;
}): GradingWarning[] {
  const warnings: GradingWarning[] = [];

  if (input.rawTruncated) {
    warnings.push(GRADING_WARNINGS.rawTruncated);
  }

  if (
    input.outputTokens != null &&
    input.outputTokens > 0 &&
    input.outputTokens < LOW_OUTPUT_TOKENS_THRESHOLD
  ) {
    warnings.push(GRADING_WARNINGS.lowOutputTokens);
  }

  return warnings;
}

/**
 * Evaluation-level warnings: facts about the graded essay that any provider
 * shares, so they are applied by the pipeline (lib/writing/service.ts) rather
 * than by an individual provider.
 */
export function computeEvaluationWarnings(input: {
  data: WritingGradingResponse;
  overall: number;
  wordCount: number;
  minWords: number;
}): GradingWarning[] {
  const warnings: GradingWarning[] = [];

  if (input.data.overall != null && Math.abs(input.data.overall - input.overall) >= OVERALL_MISMATCH_THRESHOLD) {
    warnings.push(GRADING_WARNINGS.overallMismatch);
  }

  if (input.minWords > 0 && input.wordCount < input.minWords) {
    warnings.push(GRADING_WARNINGS.underlength);
  }

  return warnings;
}

/** Merge warning lists: de-duplicated, in the documented order. */
export function mergeWarnings(...lists: GradingWarning[][]): GradingWarning[] {
  const order: GradingWarning[] = [
    GRADING_WARNINGS.overallMismatch,
    GRADING_WARNINGS.rawTruncated,
    GRADING_WARNINGS.underlength,
    GRADING_WARNINGS.lowOutputTokens,
  ];
  const seen = new Set(lists.flat());
  return order.filter((w) => seen.has(w));
}

/**
 * Pure, deterministic combined calculation — no I/O, so it is unit-testable.
 */
export function computeGradingWarnings(input: WarningInput): GradingWarning[] {
  return mergeWarnings(
    computeProviderWarnings({ rawTruncated: input.rawTruncated, outputTokens: input.outputTokens }),
    computeEvaluationWarnings({
      data: input.data,
      overall: input.overall,
      wordCount: input.wordCount,
      minWords: input.minWords,
    })
  );
}

/** Human-readable label for logs (never contains secrets). */
export function describeWarnings(warnings: string[]): string {
  return warnings.length ? warnings.join(",") : "-";
}

/** Convenience type alias used by callers that only need the meta shape. */
export type WarningBearingMeta = Pick<GradingMeta, "warnings">;
