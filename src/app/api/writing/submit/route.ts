import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { writingSubmissionSchema } from "@/lib/validations/writing";
import { submitAndGradeEssay } from "@/lib/writing/service";
import { apiError, handleApiError, clientIp } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";
import { countWords } from "@/lib/utils/scoring";
import { env } from "@/lib/env";
import {
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  parseIdempotencyKey,
} from "@/lib/writing/idempotency";
import { FullExamStateError } from "@/lib/full-exam/service";

export const maxDuration = 120; // AI grading can take a while

export async function POST(request: Request) {
  try {
    const session = await requireSession();

    // Per-user + per-IP limits: AI calls are expensive.
    if (
      !(await rateLimit(`submit:user:${session.userId}`, { limit: 6, windowMs: 60_000 })) ||
      !(await rateLimit(`submit:ip:${clientIp(request)}`, { limit: 12, windowMs: 60_000 }))
    ) {
      return apiError(429, "rate_limited");
    }

    const body = await request.json();
    const input = writingSubmissionSchema.parse(body);

    if (env.writingEnforceMinWords && countWords(input.essay) < env.writingMinWords) {
      return apiError(400, "essay_too_short_words", `Essay must be at least ${env.writingMinWords} words.`);
    }

    const locale = request.headers.get("x-axi-locale") === "ru" ? "ru" : "uz";
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const fullExamSessionId = request.headers.get("x-full-exam-id")?.trim() || null;

    const result = await submitAndGradeEssay({
      userId: session.userId,
      input,
      feedbackLocale: locale,
      idempotencyKey,
      fullExamSessionId,
    });

    if (result.status === "FAILED") {
      return apiError(502, "grading_failed", "Something went wrong. Please try again.");
    }
    if (result.status === "PROCESSING") {
      return NextResponse.json(
        { submissionId: result.submissionId, status: result.status },
        { status: 202 }
      );
    }

    // `debug` is only present outside production (see lib/ai/debug.ts).
    return NextResponse.json({
      submissionId: result.submissionId,
      ...(result.debug ? { debug: result.debug } : {}),
    });
  } catch (error) {
    if (error instanceof InvalidIdempotencyKeyError) {
      return apiError(400, error.message);
    }
    if (error instanceof IdempotencyConflictError) {
      return apiError(409, error.message);
    }
    if (error instanceof FullExamStateError) return apiError(409, error.code);
    return handleApiError(error);
  }
}
