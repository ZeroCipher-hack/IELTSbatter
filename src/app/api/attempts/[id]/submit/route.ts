import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { submitAttemptSchema } from "@/lib/validations/testing";
import { submitAttempt } from "@/lib/testing/service";
import { apiError, handleApiError, clientIp } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Submit and grade an attempt. Scoring is deterministic server-side work
 * against the stored answer key — no AI provider is involved.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();

    if (
      !rateLimit(`submit-attempt:user:${session.userId}`, { limit: 30, windowMs: 60_000 }) ||
      !rateLimit(`submit-attempt:ip:${clientIp(request)}`, { limit: 60, windowMs: 60_000 })
    ) {
      return apiError(429, "rate_limited");
    }

    // A submit may be retried by the client; an empty body is acceptable.
    const body = await request.json().catch(() => ({}));
    const input = submitAttemptSchema.parse(body);

    const result = await submitAttempt({
      userId: session.userId,
      attemptId: params.id,
      responses: input.responses,
    });
    if (!result) return apiError(404, "attempt_not_found");

    return NextResponse.json({ result });
  } catch (error) {
    return handleApiError(error);
  }
}
