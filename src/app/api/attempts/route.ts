import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { startAttemptSchema } from "@/lib/validations/testing";
import { getModuleProgress, startAttempt, type ObjectiveModule } from "@/lib/testing/service";
import { apiError, handleApiError, clientIp } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";

export const dynamic = "force-dynamic";

/** Start a new attempt for the signed-in user. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();

    if (!rateLimit(`attempt:user:${session.userId}`, { limit: 20, windowMs: 60_000 })) {
      return apiError(429, "rate_limited");
    }

    const input = startAttemptSchema.parse(await request.json());
    const created = await startAttempt({
      userId: session.userId,
      testId: input.testId,
      module: input.module as ObjectiveModule,
    });
    if (!created) return apiError(404, "test_not_found");

    return NextResponse.json({ attemptId: created.attemptId }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Objective-module progress summaries (Reading + Listening) for the dashboard. */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!rateLimit(`attempt-list:ip:${clientIp(request)}`, { limit: 120, windowMs: 60_000 })) {
      return apiError(429, "rate_limited");
    }

    const reading = await getModuleProgress(session.userId, "READING");
    const listening = await getModuleProgress(session.userId, "LISTENING");
    return NextResponse.json({ modules: { READING: reading, LISTENING: listening } });
  } catch (error) {
    return handleApiError(error);
  }
}
