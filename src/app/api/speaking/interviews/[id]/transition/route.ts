import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  SpeakingSubmissionStateError,
  transitionSpeakingInterview,
} from "@/lib/speaking/service";
import { apiError, handleApiError } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";

const schema = z.object({ action: z.literal("BEGIN_PART") }).strict();

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!(await rateLimit(`speaking-transition:user:${session.userId}`, { limit: 30, windowMs: 60_000 }))) {
      return apiError(429, "rate_limited");
    }
    const { id } = await props.params;
    const input = schema.parse(await request.json());
    const interview = await transitionSpeakingInterview({
      userId: session.userId,
      interviewId: id,
      action: input.action,
    });
    if (!interview) return apiError(404, "interview_not_found");
    return NextResponse.json({ interview });
  } catch (error) {
    if (error instanceof SpeakingSubmissionStateError) return apiError(409, error.code);
    return handleApiError(error);
  }
}
