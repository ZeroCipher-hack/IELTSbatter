import { prisma } from "@/lib/db";
import type { AIGrader } from "@/lib/ai/schema";
import { AIGradingError, getGrader } from "@/lib/ai/grading";
import { debugInfoForResponse, logAiDebug, type AIDebugInfo } from "@/lib/ai/debug";
import { sanitizeAiText } from "@/lib/ai/sanitize";
import { computeEvaluationWarnings, mergeWarnings, type GradingWarning } from "@/lib/ai/warnings";
import { env } from "@/lib/env";
import { countWords } from "@/lib/utils/scoring";
import type { WritingSubmissionInput } from "@/lib/validations/writing";
import { Prisma } from "@prisma/client";
import {
  IdempotencyConflictError,
  writingRequestFingerprint,
} from "@/lib/writing/idempotency";

/**
 * Full writing grading pipeline:
 *  create submission -> call AI -> validate -> persist score/feedback/errors
 *  -> store raw AI response + evaluation metadata -> mark completed.
 *
 * If AI grading fails the submission is marked FAILED (never crashes the app)
 * and the failure is recorded in AiEvaluation for debugging, including the
 * prompt version/attempts/validation status that produced it.
 *
 * The overall band always comes from the AI layer's server-side computation
 * (lib/ai/result.ts -> lib/utils/scoring.ts), never from the model's own
 * "overall" field.
 */
export interface GradingOutcome {
  submissionId: string;
  status: "COMPLETED" | "FAILED" | "PROCESSING";
  /** Development-only diagnostics; undefined in production (see lib/ai/debug.ts). */
  debug?: AIDebugInfo;
}

export async function submitAndGradeEssay(params: {
  userId: string;
  input: WritingSubmissionInput;
  feedbackLocale: string;
  idempotencyKey?: string | null;
}): Promise<GradingOutcome> {
  const { userId, input, feedbackLocale, idempotencyKey = null } = params;
  const wordCount = countWords(input.essay);

  await failStaleWritingSubmissions(userId);

  const requestFingerprint = idempotencyKey
    ? writingRequestFingerprint(input, feedbackLocale)
    : null;
  let submission;
  try {
    submission = await prisma.submission.create({
      data: {
        userId,
        module: "WRITING",
        testType: input.testType,
        question: input.question,
        essay: input.essay,
        wordCount,
        status: "PENDING",
        idempotencyKey,
        requestFingerprint,
      },
    });
  } catch (error) {
    if (!(idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      throw error;
    }
    const existing = await prisma.submission.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    if (!existing) throw error;
    if (existing.requestFingerprint !== requestFingerprint) throw new IdempotencyConflictError();
    if (existing.status === "COMPLETED" || existing.status === "PROCESSING") {
      return { submissionId: existing.id, status: existing.status };
    }
    submission = existing;
  }

  // Exactly one parallel request is allowed to call the provider. Failed
  // submissions may be reclaimed with the same key; no new row is created.
  const claimed = await prisma.submission.updateMany({
    where: { id: submission.id, userId, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "PROCESSING", processingStartedAt: new Date() },
  });
  if (claimed.count !== 1) {
    const current = await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } });
    return {
      submissionId: submission.id,
      status: current.status === "COMPLETED" ? "COMPLETED" : "PROCESSING",
    };
  }

  // NOTE: the grader is resolved inside the try on purpose — a misconfigured
  // provider (e.g. AI_MODE=gemini without GEMINI_API_KEY) must fail like any
  // other grading error and mark the submission FAILED, never leave it PENDING.
  let grader: AIGrader | undefined;

  try {
    grader = getGrader();
    const result = await grader.gradeWriting({
      question: input.question,
      essay: input.essay,
      feedbackLocale,
      testType: input.testType,
    });

    const { data, overall, meta } = result;

    // Essay-level warnings are provider-agnostic, so the pipeline adds them to
    // whatever the provider reported (see lib/ai/warnings.ts).
    const warnings: GradingWarning[] = mergeWarnings(
      meta.warnings as GradingWarning[],
      computeEvaluationWarnings({
        data,
        overall,
        wordCount,
        minWords: env.writingMinWords,
      })
    );
    logAiDebug({ ...meta, warnings });

    await prisma.$transaction([
      prisma.score.upsert({
        where: { submissionId: submission.id },
        update: {
          taskResponse: data.scores.taskResponse.band,
          coherenceCohesion: data.scores.coherenceCohesion.band,
          lexicalResource: data.scores.lexicalResource.band,
          grammar: data.scores.grammar.band,
          overall,
        },
        create: {
          submissionId: submission.id,
          taskResponse: data.scores.taskResponse.band,
          coherenceCohesion: data.scores.coherenceCohesion.band,
          lexicalResource: data.scores.lexicalResource.band,
          grammar: data.scores.grammar.band,
          overall,
        },
      }),
      prisma.feedback.upsert({
        where: { submissionId: submission.id },
        update: {
          summary: data.summary,
          taskResponseNote: data.scores.taskResponse.note,
          coherenceCohesionNote: data.scores.coherenceCohesion.note,
          lexicalResourceNote: data.scores.lexicalResource.note,
          grammarNote: data.scores.grammar.note,
          strengths: data.strengths,
          weaknesses: data.weaknesses,
          improvements: data.improvements,
        },
        create: {
          submissionId: submission.id,
          summary: data.summary,
          taskResponseNote: data.scores.taskResponse.note,
          coherenceCohesionNote: data.scores.coherenceCohesion.note,
          lexicalResourceNote: data.scores.lexicalResource.note,
          grammarNote: data.scores.grammar.note,
          strengths: data.strengths,
          weaknesses: data.weaknesses,
          improvements: data.improvements,
        },
      }),
      prisma.essayError.deleteMany({ where: { submissionId: submission.id } }),
      ...(data.errors.length
        ? [
            prisma.essayError.createMany({
              data: data.errors.map((e) => ({
                submissionId: submission.id,
                category: e.category,
                originalText: e.originalText,
                correction: e.correction,
                explanation: e.explanation,
                frequency: e.frequency ?? 1,
                isSystematic: e.isSystematic ?? false,
              })),
            }),
          ]
        : []),
      prisma.aiEvaluation.create({
        data: {
          submissionId: submission.id,
          provider: meta.provider,
          model: meta.model,
          promptVersion: meta.promptVersion,
          rawResponse: meta.rawResponse,
          latencyMs: meta.latencyMs,
          success: true,
          attempts: meta.attempts,
          retryCount: meta.retryCount,
          validationStatus: meta.validationStatus,
          inputTokens: meta.inputTokens,
          outputTokens: meta.outputTokens,
          warnings,
        },
      }),
      prisma.submission.update({
        where: { id: submission.id },
        data: { status: "COMPLETED", processingStartedAt: null },
      }),
    ]);

    return {
      submissionId: submission.id,
      status: "COMPLETED",
      debug: debugInfoForResponse(meta),
    };
  } catch (error) {
    // Keep the full diagnostics when the grader reported them; otherwise
    // fall back to what the provider object knows (never a secret).
    const gradingError = error instanceof AIGradingError ? error.details : undefined;
    // `grader` may be undefined when provider configuration itself failed.
    const failureProvider = gradingError?.provider ?? grader?.provider ?? "unconfigured";
    const failureModel = gradingError?.model ?? grader?.model ?? "unconfigured";

    console.error(
      "[writing] grading failed for submission",
      submission.id,
      sanitizeAiText(error instanceof Error ? error.message : String(error))
    );

    await prisma.$transaction([
      prisma.aiEvaluation.create({
        data: {
          submissionId: submission.id,
          provider: failureProvider,
          model: failureModel,
          promptVersion: gradingError?.promptVersion ?? grader?.promptVersion ?? "unknown",
          rawResponse: gradingError?.rawResponse
            ? gradingError.rawResponse
            : `ERROR: ${sanitizeAiText(error instanceof Error ? error.message : String(error))}`,
          latencyMs: gradingError?.latencyMs ?? null,
          success: false,
          attempts: gradingError?.attempts ?? null,
          retryCount: gradingError?.retryCount ?? null,
          validationStatus: gradingError?.validationStatus ?? "PROVIDER_ERROR",
          warnings: [],
        },
      }),
      prisma.submission.update({
        where: { id: submission.id },
        data: { status: "FAILED", processingStartedAt: null },
      }),
    ]);
    return {
      submissionId: submission.id,
      status: "FAILED",
      debug: gradingError
        ? debugInfoForResponse({
            provider: gradingError.provider,
            model: gradingError.model,
            promptVersion: gradingError.promptVersion,
            rawResponse: "",
            latencyMs: gradingError.latencyMs,
            attempts: gradingError.attempts,
            retryCount: gradingError.retryCount,
            validationStatus: gradingError.validationStatus,
            validationErrors: gradingError.validationErrors,
            inputTokens: null,
            outputTokens: null,
            warnings: [],
          })
        : undefined,
    };
  }
}

/** Load a submission with all grading artefacts — ONLY if owned by userId. */
export async function getOwnSubmission(userId: string, submissionId: string) {
  await failStaleWritingSubmissions(userId);
  return prisma.submission.findFirst({
    where: { id: submissionId, userId },
    include: {
      score: true,
      feedback: true,
      errors: { orderBy: { createdAt: "asc" } },
      aiEvaluations: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { provider: true, success: true },
      },
    },
  });
}

export async function listOwnSubmissions(userId: string) {
  await failStaleWritingSubmissions(userId);
  return prisma.submission.findMany({
    where: { userId, module: "WRITING" },
    orderBy: { createdAt: "desc" },
    include: {
      score: true,
      aiEvaluations: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { provider: true, success: true },
      },
    },
  });
}

export async function getProgressStats(userId: string) {
  await failStaleWritingSubmissions(userId);
  const submissions = await prisma.submission.findMany({
    where: { userId, module: "WRITING", status: "COMPLETED" },
    orderBy: { createdAt: "asc" },
    include: { score: true },
  });

  const scored = submissions.filter((s) => s.score);
  const count = scored.length;

  const avg = (pick: (s: (typeof scored)[number]) => number) =>
    count ? Math.round((scored.reduce((sum, s) => sum + pick(s), 0) / count) * 10) / 10 : 0;

  return {
    essaysSubmitted: count,
    averageOverall: avg((s) => s.score!.overall),
    averageTaskResponse: avg((s) => s.score!.taskResponse),
    averageCoherence: avg((s) => s.score!.coherenceCohesion),
    averageLexical: avg((s) => s.score!.lexicalResource),
    averageGrammar: avg((s) => s.score!.grammar),
    history: scored.map((s) => ({
      id: s.id,
      date: s.createdAt.toISOString(),
      overall: s.score!.overall,
    })),
  };
}

async function failStaleWritingSubmissions(userId: string): Promise<void> {
  await prisma.submission.updateMany({
    where: {
      userId,
      module: "WRITING",
      status: { in: ["PENDING", "PROCESSING"] },
      OR: [
        { status: "PENDING", createdAt: { lt: new Date(Date.now() - 5 * 60_000) } },
        { status: "PROCESSING", processingStartedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
      ],
    },
    data: { status: "FAILED", processingStartedAt: null },
  });
}

/**
 * AI evaluation history for a submission (owner only) — used by debugging
 * tooling and future "compare V1 vs V2" views.
 */
export async function getSubmissionAiEvaluations(userId: string, submissionId: string) {
  return prisma.aiEvaluation.findMany({
    where: { submissionId, submission: { userId } },
    orderBy: { createdAt: "desc" },
  });
}
