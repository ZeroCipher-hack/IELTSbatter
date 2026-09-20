import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { startOrResumeFullExam } from "@/lib/full-exam/service";
import { apiError, handleApiError } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";
export async function POST() {
  try { const session = await requireSession(); if (!(await rateLimit(`full-exam-start:user:${session.userId}`, { limit: 5, windowMs: 60_000 }))) return apiError(429, "rate_limited"); const exam = await startOrResumeFullExam(session.userId); return NextResponse.json({ exam }, { status: 201 }); }
  catch (error) { return handleApiError(error); }
}
