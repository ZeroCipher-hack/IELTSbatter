import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { refreshFullExam } from "@/lib/full-exam/service";
import { apiError, handleApiError } from "@/lib/utils/api";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  try { const session = await requireSession(); const { id } = await props.params; const exam = await refreshFullExam(session.userId, id); if (!exam) return apiError(404, "full_exam_not_found"); return NextResponse.json({ exam }); }
  catch (error) { return handleApiError(error); }
}
