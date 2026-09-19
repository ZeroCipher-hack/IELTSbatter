import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { evaluateSpeakingSubmission } from "@/lib/speaking/service";
import { evaluateSpeakingSchema } from "@/lib/validations/speaking";
import { apiError, handleApiError } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";

export const maxDuration = 120; // transcription + grading can take a while

/**
 * Run the speaking pipeline for the caller's own submission:
 * audio -> transcript -> evaluation -> stored result.
 *
 * Mock providers (AI_MODE=mock) are fine here; their output is flagged
 * isMock=true and shown as MOCK. Real providers are configured later through
 * environment variables only — nothing in this route touches the API key.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();

    if (!rateLimit(`speaking-eval:user:${session.userId}`, { limit: 10, windowMs: 60_000 })) {
      return apiError(429, "rate_limited");
    }

    const body = await request.json().catch(() => ({}));
    const input = evaluateSpeakingSchema.parse(body);

    const result = await evaluateSpeakingSubmission({
      userId: session.userId,
      submissionId: params.id,
      feedbackLocale: input.locale,
    });
    if (!result) return apiError(404, "submission_not_found");

    if (result.status === "FAILED") {
      // Never leak raw provider output or secrets to the client.
      return apiError(
        502,
        "evaluation_failed",
        result.reason === "empty_transcript"
          ? "No intelligible speech was found in the recording."
          : "Evaluation could not be completed. Please try again."
      );
    }

    return NextResponse.json({
      submissionId: result.submissionId,
      status: result.status,
      isMock: result.isMock,
      overall: result.overall,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
