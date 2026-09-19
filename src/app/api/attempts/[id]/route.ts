import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { saveAnswersSchema } from "@/lib/validations/testing";
import { getOwnAttempt, saveAnswers } from "@/lib/testing/service";
import { apiError, handleApiError } from "@/lib/utils/api";

export const dynamic = "force-dynamic";

/** Owner-scoped attempt state (used to restore an in-progress attempt). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();

    const attempt = await getOwnAttempt(session.userId, params.id);
    if (!attempt) return apiError(404, "attempt_not_found");

    return NextResponse.json({
      attempt: {
        id: attempt.id,
        status: attempt.status,
        testId: attempt.test.id,
        testTitle: attempt.test.title,
        module: attempt.module,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        durationMinutes: attempt.test.durationMinutes,
        timeSpentSeconds: attempt.timeSpentSeconds,
        band: attempt.band,
        responses: Object.fromEntries(attempt.answers.map((a) => [a.questionId, a.response])),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Autosave answers while the attempt is in progress. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();

    const input = saveAnswersSchema.parse(await request.json());
    const saved = await saveAnswers({
      userId: session.userId,
      attemptId: params.id,
      responses: input.responses,
    });

    // Unknown attempt, another user's attempt, or an already graded attempt.
    if (!saved) return apiError(409, "attempt_not_editable");

    return NextResponse.json({ saved: saved.saved });
  } catch (error) {
    return handleApiError(error);
  }
}
