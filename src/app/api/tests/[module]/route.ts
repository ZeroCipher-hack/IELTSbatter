import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { objectiveModuleSchema } from "@/lib/validations/testing";
import { listPublishedTests, type ObjectiveModule } from "@/lib/testing/service";
import { apiError, handleApiError } from "@/lib/utils/api";

export const dynamic = "force-dynamic";

/** Published test catalog for a module. Tests themselves are learner-safe. */
export async function GET(_request: Request, props: { params: Promise<{ module: string }> }) {
  const params = await props.params;
  try {
    await requireSession();

    const parsed = objectiveModuleSchema.safeParse(params.module.toUpperCase());
    if (!parsed.success) return apiError(404, "unknown_module");

    const tests = await listPublishedTests(parsed.data as ObjectiveModule);
    return NextResponse.json({ module: parsed.data, tests });
  } catch (error) {
    return handleApiError(error);
  }
}
