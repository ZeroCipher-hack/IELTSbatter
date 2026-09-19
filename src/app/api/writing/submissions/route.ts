import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { listOwnSubmissions } from "@/lib/writing/service";
import { handleApiError } from "@/lib/utils/api";

// Cookie/session based: always evaluated per request.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const submissions = await listOwnSubmissions(session.userId);
    return NextResponse.json({
      submissions: submissions.map((s) => ({
        id: s.id,
        question: s.question,
        wordCount: s.wordCount,
        status: s.status,
        overall: s.score?.overall ?? null,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
