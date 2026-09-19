import { z } from "zod";

/** Modules served by the shared objective test engine (no AI scoring). */
export const objectiveModuleSchema = z.enum(["READING", "LISTENING"]);

/**
 * A single answer: free text (short answer / sentence completion), a list of
 * values (matching groups), or null (cleared by the learner).
 */
const responseValueSchema = z.union([
  z.string().max(2000),
  z.array(z.string().max(2000)).max(50),
  z.null(),
]);

/**
 * Answers are keyed by question id. The key set is validated against the test
 * server-side; here we only bound the shape and size.
 */
export const responseMapSchema = z
  .record(responseValueSchema)
  .refine((value) => Object.keys(value).length <= 500, { message: "too_many_answers" });

export const startAttemptSchema = z.object({
  module: objectiveModuleSchema,
  testId: z.string().min(1).max(64),
});

export const saveAnswersSchema = z.object({
  responses: responseMapSchema,
});

export const submitAttemptSchema = z.object({
  responses: responseMapSchema.optional(),
});

export type ResponseMapInput = z.infer<typeof responseMapSchema>;
