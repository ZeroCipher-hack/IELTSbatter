import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getPublicSpeakingTest } from "@/lib/speaking/service";
import { apiError, handleApiError } from "@/lib/utils/api";

export const dynamic = "force-dynamic";

/** One speaking test: parts, prompts and timers. Contains no answer keys. */
export async function GET(_request: Request, { params }: { params: { testId: string } }) {
  try {
    await requireSession();
    const test = await getPublicSpeakingTest(params.testId);
    if (!test) return apiError(404, "test_not_found");
    return NextResponse.json({ test });
  } catch (error) {
    return handleApiError(error);
  }
}
