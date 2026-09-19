import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { recoverSpeakingInterview } from "@/lib/speaking/service";
import { apiError, handleApiError } from "@/lib/utils/api";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await props.params;
    const interview = await recoverSpeakingInterview(session.userId, id);
    if (!interview) return apiError(404, "interview_not_found");
    return NextResponse.json({ interview });
  } catch (error) {
    return handleApiError(error);
  }
}
