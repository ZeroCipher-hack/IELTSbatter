import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { saveAnswersSchema } from "@/lib/validations/testing";
import { getOwnAttempt, InvalidQuestionError, saveAnswers } from "@/lib/testing/service";
import { apiError, handleApiError } from "@/lib/utils/api";

export const dynamic = "force-dynamic";

/** Owner-scoped attempt state (used to restore an in-progress attempt). */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requireSession();

    const input = saveAnswersSchema.parse(await request.json());
    const saved = await saveAnswers({
      userId: session.userId,
      attemptId: params.id,
      responses: input.responses,
    });

    if (!saved) {
      // Preserve non-enumerating ownership semantics: foreign and missing IDs
      // look identical, while the owner gets an actionable state conflict.
      const ownAttempt = await getOwnAttempt(session.userId, params.id);
      return ownAttempt
        ? apiError(409, "attempt_not_editable")
        : apiError(404, "attempt_not_found");
    }

    return NextResponse.json({ saved: saved.saved });
  } catch (error) {
    if (error instanceof InvalidQuestionError) {
      return apiError(400, "invalid_question_id");
    }
    return handleApiError(error);
  }
}
