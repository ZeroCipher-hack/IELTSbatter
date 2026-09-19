import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { recoverSpeakingInterview } from "@/lib/speaking/service";
import { apiError, handleApiError } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!(await rateLimit(`speaking-recover:user:${session.userId}`, { limit: 120, windowMs: 60_000 }))) {
      return apiError(429, "rate_limited");
    }
    const { id } = await props.params;
    const interview = await recoverSpeakingInterview(session.userId, id);
    if (!interview) return apiError(404, "interview_not_found");
    return NextResponse.json({ interview });
  } catch (error) {
    return handleApiError(error);
  }
}
