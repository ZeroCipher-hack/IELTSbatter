import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getProgressStats } from "@/lib/writing/service";
import { handleApiError } from "@/lib/utils/api";

export async function GET() {
  try {
    const session = await requireSession();
    const stats = await getProgressStats(session.userId);
    return NextResponse.json({ stats });
  } catch (error) {
    return handleApiError(error);
  }
}
