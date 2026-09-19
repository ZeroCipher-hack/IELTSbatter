import { prisma } from "@/lib/db";
import { getGrader } from "@/lib/ai/grading";
import { countWords } from "@/lib/utils/scoring";
import type { WritingSubmissionInput } from "@/lib/validations/writing";

/**
 * Full writing grading pipeline:
 *  create submission -> call AI -> validate -> persist score/feedback/errors
 *  -> store raw AI response -> mark completed.
 *
 * If AI grading fails the submission is marked FAILED (never crashes the app)
 * and the failure is recorded in AiEvaluation for debugging.
 */
export async function submitAndGradeEssay(params: {
  userId: string;
  input: WritingSubmissionInput;
  feedbackLocale: string;
}): Promise<{ submissionId: string; status: "COMPLETED" | "FAILED" }> {
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
        },
      }),
      prisma.submission.update({
        where: { id: submission.id },
        data: { status: "COMPLETED" },
      }),
    ]);

    return { submissionId: submission.id, status: "COMPLETED" };
  } catch (error) {
    console.error(
      "[writing] grading failed for submission",
      submission.id,
      error instanceof Error ? error.message : error
    );
    await prisma.$transaction([
      prisma.aiEvaluation.create({
        data: {
          submissionId: submission.id,
          provider: grader.provider,
          model: grader.model,
          promptVersion: "unknown",
          rawResponse: error instanceof Error ? `ERROR: ${error.message}` : "ERROR: unknown",
          success: false,
        },
      }),
      prisma.submission.update({
        where: { id: submission.id },
        data: { status: "FAILED" },
      }),
    ]);
    return { submissionId: submission.id, status: "FAILED" };
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
