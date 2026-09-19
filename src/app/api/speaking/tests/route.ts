import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { listSpeakingTests } from "@/lib/speaking/service";
import { handleApiError } from "@/lib/utils/api";

export const dynamic = "force-dynamic";

/** Available speaking tests (published only). */
export async function GET() {
  try {
    await requireSession();
    const tests = await listSpeakingTests();
    return NextResponse.json({ tests });
  } catch (error) {
    return handleApiError(error);
  }
}
