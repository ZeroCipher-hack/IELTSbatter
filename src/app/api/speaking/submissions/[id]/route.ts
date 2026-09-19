import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getOwnSpeakingSubmission } from "@/lib/speaking/service";
import { apiError, handleApiError } from "@/lib/utils/api";

export const dynamic = "force-dynamic";

/**
 * Status + result of the caller's own speaking submission.
 * Another user's id is indistinguishable from a missing one (404).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();

    const submission = await getOwnSpeakingSubmission(session.userId, params.id);
    if (!submission) return apiError(404, "submission_not_found");

    const result = submission.speakingResult;

    return NextResponse.json({
      submission: {
        id: submission.id,
        status: submission.status,
        question: submission.question,
        createdAt: submission.createdAt,
        recordings: submission.recordings.map((asset) => ({
          id: asset.id,
          url: `/api/audio/${asset.id}`,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          durationSeconds: asset.durationSeconds,
        })),
        result: result
          ? {
              // MOCK results are labelled in the UI; this flag is the source of truth.
              isMock: result.isMock,
              transcript: result.transcript,
              scores: {
                fluencyCoherence: result.fluencyCoherence,
                lexicalResource: result.lexicalResource,
                grammaticalRange: result.grammar,
                pronunciation: result.pronunciation,
                overall: result.overall,
              },
              summary: result.summary,
              strengths: result.strengths,
              weaknesses: result.weaknesses,
              improvements: result.improvements,
              provider: result.aiProvider,
              model: result.aiModel,
              promptVersion: result.promptVersion,
              transcriptionProvider: result.transcriptionProvider,
            }
          : null,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
