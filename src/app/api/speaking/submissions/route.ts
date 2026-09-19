import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createSpeakingSubmissionSchema } from "@/lib/validations/speaking";
import { createSpeakingSubmission } from "@/lib/speaking/service";
import { apiError, handleApiError, clientIp } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";

export const dynamic = "force-dynamic";

/** Start a speaking attempt for the signed-in user. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();

    if (
      !rateLimit(`speaking-start:user:${session.userId}`, { limit: 20, windowMs: 60_000 }) ||
      !rateLimit(`speaking-start:ip:${clientIp(request)}`, { limit: 40, windowMs: 60_000 })
    ) {
      return apiError(429, "rate_limited");
    }

    const input = createSpeakingSubmissionSchema.parse(await request.json());
    const created = await createSpeakingSubmission({
      userId: session.userId,
      testId: input.testId,
      promptId: input.promptId ?? null,
    });
    if (!created) return apiError(404, "test_not_found");

    return NextResponse.json(
      { submissionId: created.submissionId, prompt: created.prompt },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
