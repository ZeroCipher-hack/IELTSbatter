import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getProgressStats } from "@/lib/writing/service";
import { handleApiError } from "@/lib/utils/api";

// Cookie/session based: always evaluated per request.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const stats = await getProgressStats(session.userId);
    return NextResponse.json({ stats });
  } catch (error) {
    return handleApiError(error);
  }
}
