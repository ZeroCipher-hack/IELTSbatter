import { z } from "zod";

/** A band score: 0–9 in 0.5 steps. */
export const bandScoreSchema = z
  .number()
  .min(0)
  .max(9)
  .refine((v) => Number.isInteger(v * 2), {
    message: "Band score must be in 0.5 steps",
  });

export const ERROR_CATEGORIES = [
  "grammar",
  "vocabulary",
  "spelling",
  "punctuation",
  "style",
  "coherence",
] as const;

/**
 * One concrete essay error.
 *
 * `frequency` / `isSystematic` let the grader report a repeated error ONCE
 * (representative example) instead of flooding the learner with duplicates.
 * They are optional so older V1 responses remain valid.
 */
export const essayErrorSchema = z.object({
  category: z.enum(ERROR_CATEGORIES),
  originalText: z.string().min(1),
  correction: z.string().min(1),
  explanation: z.string().min(1),
  frequency: z.coerce.number().int().min(1).max(50).optional(),
  isSystematic: z.boolean().optional(),
});

export const criterionFeedbackSchema = z.object({
  band: bandScoreSchema,
  note: z.string().min(1),
});

/** The strict JSON contract the AI must return. */
export const writingGradingResponseSchema = z.object({
  scores: z.object({
    taskResponse: criterionFeedbackSchema,
    coherenceCohesion: criterionFeedbackSchema,
    lexicalResource: criterionFeedbackSchema,
    grammar: criterionFeedbackSchema,
  }),
  /**
   * Informational only. The platform ALWAYS recomputes the overall band from
   * the four criterion scores (see lib/utils/scoring.ts).
   */
  overall: bandScoreSchema.optional(),
  summary: z.string().min(1),
  strengths: z.array(z.string().min(1)).min(1).max(10),
  weaknesses: z.array(z.string().min(1)).min(1).max(10),
  improvements: z.array(z.string().min(1)).min(1).max(10),
  errors: z.array(essayErrorSchema).max(15),
});

export type WritingGradingResponse = z.infer<typeof writingGradingResponseSchema>;
export type EssayErrorItem = z.infer<typeof essayErrorSchema>;

/** How the raw provider response validated. Stored with every evaluation. */
export const VALIDATION_STATUSES = [
  "VALID",
  "INVALID_JSON",
  "SCHEMA_MISMATCH",
  "PROVIDER_ERROR",
] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export interface GradingMeta {
  provider: string;
  model: string;
  promptVersion: string;
  /** Raw provider text (last attempt). Persisted in AiEvaluation.rawResponse. */
  rawResponse: string;
  /** Total wall-clock time across all attempts. */
  latencyMs: number;
  /** Attempts used (1 = success on first try). */
  attempts: number;
  /** attempts - 1 */
  retryCount: number;
  validationStatus: ValidationStatus;
  /** Zod issues / parser errors, for debugging. Empty when VALID. */
  validationErrors: string[];
  /** Cost-control placeholders; null when the provider does not report them. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Non-fatal observations persisted for operators (see lib/ai/warnings.ts). */
  warnings: string[];
}

export interface WritingGradingInput {
  question: string;
  essay: string;
  /** "uz" | "ru" — language for the feedback text. */
  feedbackLocale: string;
  testType?: string;
}

export interface WritingGradingResult {
  /** Validated AI payload. */
  data: WritingGradingResponse;
  /** Overall computed server-side with IELTS rounding. */
  overall: number;
  meta: GradingMeta;
}

/** Provider abstraction — swap Gemini for any other model behind this. */
export interface AIGrader {
  readonly provider: string;
  readonly model: string;
  /** Prompt version this grader is configured to use. */
  readonly promptVersion: string;
  gradeWriting(input: WritingGradingInput): Promise<WritingGradingResult>;
}
