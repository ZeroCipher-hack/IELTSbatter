import { z } from "zod";

/** A band score: 0–9 in 0.5 steps. */
export const bandScoreSchema = z
  .number()
  .min(0)
  .max(9)
  .refine((v) => Number.isInteger(v * 2), {
    message: "Band score must be in 0.5 steps",
  });

export const essayErrorSchema = z.object({
  category: z.enum(["grammar", "vocabulary", "spelling", "punctuation", "style", "coherence"]),
  originalText: z.string().min(1),
  correction: z.string().min(1),
  explanation: z.string().min(1),
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
  summary: z.string().min(1),
  strengths: z.array(z.string().min(1)).min(1).max(10),
  weaknesses: z.array(z.string().min(1)).min(1).max(10),
  improvements: z.array(z.string().min(1)).min(1).max(10),
  errors: z.array(essayErrorSchema).max(30),
});

export type WritingGradingResponse = z.infer<typeof writingGradingResponseSchema>;
export type EssayErrorItem = z.infer<typeof essayErrorSchema>;

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
  meta: {
    provider: string;
    model: string;
    promptVersion: string;
    rawResponse: string;
    latencyMs: number;
  };
}

/** Provider abstraction — swap Gemini for any other model behind this. */
export interface AIGrader {
  readonly provider: string;
  readonly model: string;
  gradeWriting(input: WritingGradingInput): Promise<WritingGradingResult>;
}
