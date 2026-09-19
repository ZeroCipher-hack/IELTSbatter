import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getOwnAttemptResult } from "@/lib/testing/service";
import { apiError, handleApiError } from "@/lib/utils/api";

export const dynamic = "force-dynamic";

/**
 * Full result for the attempt owner only: score, band, per-question review with
 * the correct answers and explanations. Attempts belonging to other users are
 * indistinguishable from missing ones (404), so ids cannot be probed.
 */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await requireSession();

    const result = await getOwnAttemptResult(session.userId, params.id);
    if (!result) return apiError(404, "result_not_found");

    return NextResponse.json({ result: { ...result, isMock: false } });
  } catch (error) {
    return handleApiError(error);
  }
}
