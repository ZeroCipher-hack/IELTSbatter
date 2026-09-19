import { z } from "zod";

export const writingSubmissionSchema = z.object({
  question: z.string().trim().min(10, "question_too_short").max(2000),
  essay: z.string().trim().min(50, "essay_too_short").max(10000),
  testType: z.enum(["TASK_1", "TASK_2"]).default("TASK_2"),
});

export type WritingSubmissionInput = z.infer<typeof writingSubmissionSchema>;
