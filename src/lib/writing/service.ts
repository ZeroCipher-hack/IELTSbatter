import { prisma } from "@/lib/db";
import { AIGradingError, getGrader } from "@/lib/ai/grading";
import { debugInfoForResponse, logAiDebug, type AIDebugInfo } from "@/lib/ai/debug";
import { sanitizeAiText } from "@/lib/ai/sanitize";
import { countWords } from "@/lib/utils/scoring";
import type { WritingSubmissionInput } from "@/lib/validations/writing";

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
  status: "COMPLETED" | "FAILED";
  /** Development-only diagnostics; undefined in production (see lib/ai/debug.ts). */
  debug?: AIDebugInfo;
}

export async function submitAndGradeEssay(params: {
  userId: string;
  input: WritingSubmissionInput;
  feedbackLocale: string;
}): Promise<GradingOutcome> {
  const { userId, input, feedbackLocale } = params;
  const wordCount = countWords(input.essay);

  const submission = await prisma.submission.create({
    data: {
      userId,
      module: "WRITING",
      testType: input.testType,
      question: input.question,
      essay: input.essay,
      wordCount,
      status: "PENDING",
    },
  });

  const grader = getGrader();

  try {
    const result = await grader.gradeWriting({
      question: input.question,
      essay: input.essay,
      feedbackLocale,
      testType: input.testType,
    });

    const { data, overall, meta } = result;
    logAiDebug(meta);

    await prisma.$transaction([
      prisma.score.create({
        data: {
          submissionId: submission.id,
          taskResponse: data.scores.taskResponse.band,
          coherenceCohesion: data.scores.coherenceCohesion.band,
          lexicalResource: data.scores.lexicalResource.band,
          grammar: data.scores.grammar.band,
          overall,
        },
      }),
      prisma.feedback.create({
        data: {
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
        },
      }),
      prisma.submission.update({
        where: { id: submission.id },
        data: { status: "COMPLETED" },
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

    console.error(
      "[writing] grading failed for submission",
      submission.id,
      sanitizeAiText(error instanceof Error ? error.message : String(error))
    );

    await prisma.$transaction([
      prisma.aiEvaluation.create({
        data: {
          submissionId: submission.id,
          provider: gradingError?.provider ?? grader.provider,
          model: gradingError?.model ?? grader.model,
          promptVersion: gradingError?.promptVersion ?? grader.promptVersion ?? "unknown",
          rawResponse: gradingError?.rawResponse
            ? gradingError.rawResponse
            : `ERROR: ${sanitizeAiText(error instanceof Error ? error.message : String(error))}`,
          latencyMs: gradingError?.latencyMs ?? null,
          success: false,
          attempts: gradingError?.attempts ?? null,
          retryCount: gradingError?.retryCount ?? null,
          validationStatus: gradingError?.validationStatus ?? "PROVIDER_ERROR",
        },
      }),
      prisma.submission.update({
        where: { id: submission.id },
        data: { status: "FAILED" },
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
          })
        : undefined,
    };
  }
}

/** Load a submission with all grading artefacts — ONLY if owned by userId. */
export async function getOwnSubmission(userId: string, submissionId: string) {
  return prisma.submission.findFirst({
    where: { id: submissionId, userId },
    include: {
      score: true,
      feedback: true,
      errors: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function listOwnSubmissions(userId: string) {
  return prisma.submission.findMany({
    where: { userId, module: "WRITING" },
    orderBy: { createdAt: "desc" },
    include: { score: true },
  });
}

export async function getProgressStats(userId: string) {
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
