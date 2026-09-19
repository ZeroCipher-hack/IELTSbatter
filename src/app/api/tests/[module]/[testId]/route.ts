import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { objectiveModuleSchema } from "@/lib/validations/testing";
import { getPublicTest, type ObjectiveModule } from "@/lib/testing/service";
import { apiError, handleApiError } from "@/lib/utils/api";

export const dynamic = "force-dynamic";

/**
 * Learner-safe test payload: sections, questions and options only.
 * Correct answers and explanations are stripped server-side and are revealed
 * only after the attempt has been graded.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ module: string; testId: string }> }
) {
  const params = await props.params;
  try {
    await requireSession();

    const parsed = objectiveModuleSchema.safeParse(params.module.toUpperCase());
    if (!parsed.success) return apiError(404, "unknown_module");

    const test = await getPublicTest(params.testId, parsed.data as ObjectiveModule);
    if (!test) return apiError(404, "test_not_found");

    return NextResponse.json({ test });
  } catch (error) {
    return handleApiError(error);
  }
}
