import { Prisma, type Module } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeFullExamOverall, weakestFullExamModules, type FullExamBands } from "@/lib/full-exam/scoring";

const ACTIVE_STATUSES = ["IN_PROGRESS", "PROCESSING"] as const;
const SESSION_MAX_AGE_MS = 8 * 60 * 60_000;
export class FullExamStateError extends Error {
  constructor(readonly code: "full_exam_not_active" | "full_exam_module_conflict") { super(code); this.name = "FullExamStateError"; }
}
export type FullExamComponentStatus = "NOT_STARTED" | "IN_PROGRESS" | "PROCESSING" | "COMPLETED" | "FAILED";
export interface FullExamSnapshot {
  id: string; status: "IN_PROGRESS" | "PROCESSING" | "COMPLETED" | "FAILED";
  startedAt: string; submittedAt: string | null; completedAt: string | null;
  components: Record<Lowercase<Module>, { status: FullExamComponentStatus; band: number | null; resultId: string | null }>;
  overallBand: number | null; weakestModules: Array<keyof FullExamBands>;
}

export async function startOrResumeFullExam(userId: string): Promise<FullExamSnapshot> {
  await prisma.fullExamSession.updateMany({ where: { userId, status: { in: [...ACTIVE_STATUSES] }, startedAt: { lt: new Date(Date.now() - SESSION_MAX_AGE_MS) } }, data: { status: "FAILED", completedAt: new Date() } });
  let session = await prisma.fullExamSession.findFirst({ where: { userId, status: { in: [...ACTIVE_STATUSES] } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!session) {
    try { session = await prisma.fullExamSession.create({ data: { userId }, select: { id: true } }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      session = await prisma.fullExamSession.findFirstOrThrow({ where: { userId, status: { in: [...ACTIVE_STATUSES] } }, orderBy: { createdAt: "desc" }, select: { id: true } });
    }
  }
  return (await refreshFullExam(userId, session.id))!;
}
export async function listOwnFullExams(userId: string) {
  return prisma.fullExamSession.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, overallBand: true, listeningBand: true, readingBand: true, writingBand: true, speakingBand: true, startedAt: true, completedAt: true } });
}
export async function requireActiveFullExam(userId: string, sessionId: string) {
  const session = await prisma.fullExamSession.findFirst({ where: { id: sessionId, userId }, select: { id: true, status: true } });
  if (!session) return null;
  if (!ACTIVE_STATUSES.includes(session.status as (typeof ACTIVE_STATUSES)[number])) throw new FullExamStateError("full_exam_not_active");
  return session;
}
export async function requireFullExamModuleAccess(userId: string, sessionId: string, module: Module): Promise<FullExamSnapshot> {
  const snapshot = await refreshFullExam(userId, sessionId);
  if (!snapshot || !ACTIVE_STATUSES.includes(snapshot.status as (typeof ACTIVE_STATUSES)[number])) throw new FullExamStateError("full_exam_not_active");
  const order: Module[] = ["LISTENING", "READING", "WRITING", "SPEAKING"];
  const index = order.indexOf(module);
  if (index < 0) throw new FullExamStateError("full_exam_module_conflict");
  const current = snapshot.components[module.toLowerCase() as Lowercase<Module>];
  if (current.status === "COMPLETED") throw new FullExamStateError("full_exam_module_conflict");
  if (current.status === "PROCESSING" || (module === "WRITING" && current.status === "IN_PROGRESS")) throw new FullExamStateError("full_exam_module_conflict");
  const previous = order.slice(0, index).map((name) => snapshot.components[name.toLowerCase() as Lowercase<Module>]);
  if (previous.some((component) => component.status !== "COMPLETED")) throw new FullExamStateError("full_exam_module_conflict");
  return snapshot;
}
export async function attachAttemptToFullExam(params: { userId: string; sessionId: string; attemptId: string; module: "READING" | "LISTENING" }): Promise<void> {
  if (!(await requireActiveFullExam(params.userId, params.sessionId))) throw new FullExamStateError("full_exam_not_active");
  const attempt = await prisma.testAttempt.findFirst({ where: { id: params.attemptId, userId: params.userId, module: params.module }, select: { fullExamSessionId: true } });
  if (!attempt || (attempt.fullExamSessionId && attempt.fullExamSessionId !== params.sessionId)) throw new FullExamStateError("full_exam_module_conflict");
  await prisma.testAttempt.update({ where: { id: params.attemptId }, data: { fullExamSessionId: params.sessionId } });
}

export async function refreshFullExam(userId: string, sessionId: string): Promise<FullExamSnapshot | null> {
  const staleBefore = new Date(Date.now() - 5 * 60_000);
  await prisma.$transaction([
    prisma.submission.updateMany({ where: { fullExamSessionId: sessionId, userId, status: "PROCESSING", processingStartedAt: { lt: staleBefore } }, data: { status: "FAILED", processingStartedAt: null } }),
    prisma.speakingInterview.updateMany({ where: { userId, submission: { fullExamSessionId: sessionId }, state: { in: ["UPLOADING", "TRANSCRIBING", "EVALUATING"] }, stateStartedAt: { lt: staleBefore } }, data: { state: "FAILED", failureReason: "pipeline_timeout", completedAt: new Date() } }),
    prisma.submission.updateMany({ where: { fullExamSessionId: sessionId, userId, module: "SPEAKING", status: { in: ["PENDING", "PROCESSING"] }, speakingInterview: { state: "FAILED" } }, data: { status: "FAILED", processingStartedAt: null } }),
  ]);
  const session = await prisma.fullExamSession.findFirst({ where: { id: sessionId, userId }, include: { attempts: { orderBy: { createdAt: "desc" } }, submissions: { orderBy: { createdAt: "desc" }, include: { score: true, speakingResult: true, speakingInterview: { select: { state: true } } } } } });
  if (!session) return null;
  const reading = objectiveComponent(session.attempts, "READING");
  const listening = objectiveComponent(session.attempts, "LISTENING");
  const writing = submissionComponent(session.submissions, "WRITING");
  const speaking = submissionComponent(session.submissions, "SPEAKING");
  const components = { listening, reading, writing, speaking };
  const complete = Object.values(components).every((item) => item.status === "COMPLETED" && item.band != null);
  const allStarted = Object.values(components).every((item) => item.status !== "NOT_STARTED");
  const hasProcessing = Object.values(components).some((item) => item.status === "PROCESSING");
  let overallBand: number | null = null; let weakestModules: Array<keyof FullExamBands> = [];
  if (complete) { const bands = { listening: listening.band!, reading: reading.band!, writing: writing.band!, speaking: speaking.band! }; overallBand = computeFullExamOverall(bands); weakestModules = weakestFullExamModules(bands); }
  const nextStatus = complete ? "COMPLETED" : hasProcessing ? "PROCESSING" : session.status === "FAILED" ? "FAILED" : "IN_PROGRESS";
  const submittedAt = session.submittedAt ?? (allStarted ? new Date() : null);
  const completedAt = complete ? session.completedAt ?? new Date() : session.completedAt;
  if (session.status !== nextStatus || session.overallBand !== overallBand || session.listeningBand !== listening.band || session.readingBand !== reading.band || session.writingBand !== writing.band || session.speakingBand !== speaking.band || session.submittedAt?.getTime() !== submittedAt?.getTime() || session.completedAt?.getTime() !== completedAt?.getTime()) {
    await prisma.fullExamSession.update({ where: { id: session.id }, data: { status: nextStatus, listeningBand: listening.band, readingBand: reading.band, writingBand: writing.band, speakingBand: speaking.band, overallBand, submittedAt, completedAt } });
  }
  return { id: session.id, status: nextStatus, startedAt: session.startedAt.toISOString(), submittedAt: submittedAt?.toISOString() ?? null, completedAt: completedAt?.toISOString() ?? null, components, overallBand, weakestModules };
}
function objectiveComponent(attempts: Array<{ id: string; module: Module; status: string; band: number | null }>, module: "READING" | "LISTENING") {
  const candidates = attempts.filter((item) => item.module === module); const item = candidates.find((candidate) => candidate.status === "GRADED") ?? candidates[0];
  if (!item) return emptyComponent();
  return { status: item.status === "GRADED" ? "COMPLETED" as const : item.status === "FAILED" ? "FAILED" as const : "IN_PROGRESS" as const, band: item.status === "GRADED" ? item.band : null, resultId: item.status === "GRADED" ? item.id : null };
}
function submissionComponent(submissions: Array<{ id: string; module: Module; status: string; score: { overall: number } | null; speakingResult: { overall: number } | null; speakingInterview: { state: string } | null }>, module: "WRITING" | "SPEAKING") {
  const candidates = submissions.filter((item) => item.module === module); const item = candidates.find((candidate) => candidate.status === "COMPLETED") ?? candidates[0];
  if (!item) return emptyComponent(); const band = module === "WRITING" ? item.score?.overall ?? null : item.speakingResult?.overall ?? null;
  return { status: item.status === "COMPLETED" && band != null ? "COMPLETED" as const : item.status === "FAILED" ? "FAILED" as const : item.status === "PROCESSING" || (module === "SPEAKING" && ["UPLOADING", "TRANSCRIBING", "EVALUATING"].includes(item.speakingInterview?.state ?? "")) ? "PROCESSING" as const : "IN_PROGRESS" as const, band, resultId: item.status === "COMPLETED" && band != null ? item.id : null };
}
function emptyComponent() { return { status: "NOT_STARTED" as const, band: null, resultId: null }; }
