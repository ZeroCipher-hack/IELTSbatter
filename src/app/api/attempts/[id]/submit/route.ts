import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { submitAttemptSchema } from "@/lib/validations/testing";
import { AttemptStateError, InvalidQuestionError, submitAttempt } from "@/lib/testing/service";
import { apiError, handleApiError, clientIp } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Submit and grade an attempt. Scoring is deterministic server-side work
 * against the stored answer key — no AI provider is involved.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requireSession();

    if (
      !(await rateLimit(`submit-attempt:user:${session.userId}`, { limit: 30, windowMs: 60_000 })) ||
      !(await rateLimit(`submit-attempt:ip:${clientIp(request)}`, { limit: 60, windowMs: 60_000 }))
    ) {
      return apiError(429, "rate_limited");
    }

    // A submit may be retried with an empty body, but malformed non-empty JSON
    // is still a client error and must not silently submit an attempt.
    const rawBody = await request.text();
    const body = rawBody.trim() ? JSON.parse(rawBody) : {};
    const input = submitAttemptSchema.parse(body);

    const result = await submitAttempt({
      userId: session.userId,
      attemptId: params.id,
      responses: input.responses,
    });
    if (!result) return apiError(404, "attempt_not_found");

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof InvalidQuestionError) {
      return apiError(400, "invalid_question_id");
    }
    if (error instanceof AttemptStateError) {
      return apiError(409, error.code);
    }
    return handleApiError(error);
  }
}
