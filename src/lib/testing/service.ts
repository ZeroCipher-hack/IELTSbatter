/**
 * Test-engine service for the objective modules (Reading, Listening).
 *
 * Responsibilities:
 *  - expose the published test catalog and a learner-safe test shape (the
 *    answer key never leaves the server before grading);
 *  - own the attempt lifecycle: start -> save answers -> submit -> graded;
 *  - grade server-side with lib/testing/scoring.ts (no AI involved);
 *  - enforce ownership on every read (users only ever see their own attempts).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { scoreAttempt } from "@/lib/testing/scoring";
import { resolveBandTable, type BandRange, type TestModule } from "@/lib/testing/band-conversion";
import {
  flattenQuestions,
  toPublicTest,
  type QuestionDefinition,
  type QuestionType,
  type ResponseMap,
  type PublicTest,
  type TestDefinition,
} from "@/lib/testing/types";

export type ObjectiveModule = Extract<TestModule, "READING" | "LISTENING">;

/**
 * `answer` is stored as JSON, so its TypeScript type is the generic JsonValue
 * union. Reading it back requires a narrow, explicit conversion.
 */
function parseAnswerKey(value: unknown): QuestionDefinition["answer"] {
  const parsed = (value ?? {}) as { answers?: unknown; caseSensitive?: unknown };
  const answers = Array.isArray(parsed.answers)
    ? parsed.answers.filter((a): a is string => typeof a === "string")
    : [];
  return {
    answers,
    ...(typeof parsed.caseSensitive === "boolean" ? { caseSensitive: parsed.caseSensitive } : {}),
  };
}

const MODULE_DEFAULT_DURATION: Record<ObjectiveModule, number> = {
  READING: 60,
  LISTENING: 40,
};

/* ---------------------------------------------------------------- catalog */

export interface TestSummary {
  id: string;
  module: ObjectiveModule;
  title: string;
  description: string | null;
  durationMinutes: number;
  sectionCount: number;
  questionCount: number;
}

export async function listPublishedTests(module: ObjectiveModule): Promise<TestSummary[]> {
  const tests = await prisma.test.findMany({
    where: { module, isPublished: true },
    orderBy: { createdAt: "asc" },
    include: { sections: { include: { _count: { select: { questions: true } } } } },
  });

  return tests.map((test) => ({
    id: test.id,
    module,
    title: test.title,
    description: test.description,
    durationMinutes: test.durationMinutes || MODULE_DEFAULT_DURATION[module],
    sectionCount: test.sections.length,
    questionCount: test.sections.reduce((sum, s) => sum + s._count.questions, 0),
  }));
}

/** Load a test with sections, questions and audio — server-side shape. */
export async function loadTestDefinition(
  testId: string,
  module: ObjectiveModule
): Promise<TestDefinition | null> {
  const test = await prisma.test.findFirst({
    where: { id: testId, module, isPublished: true },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: {
          questions: { orderBy: { order: "asc" } },
          audioAsset: true,
        },
      },
    },
  });

  if (!test) return null;

  return {
    id: test.id,
    module,
    title: test.title,
    description: test.description,
    durationMinutes: test.durationMinutes || MODULE_DEFAULT_DURATION[module],
    sections: test.sections.map((section) => ({
      id: section.id,
      order: section.order,
      title: section.title,
      instructions: section.instructions,
      passage: section.passage,
      audioUrl: section.audioAsset?.url ?? null,
      audioDurationSeconds: section.audioAsset?.durationSeconds ?? null,
      questions: section.questions.map((question) => ({
        id: question.id,
        number: question.number,
        order: question.order,
        type: question.type as QuestionType,
        prompt: question.prompt,
        options: parseOptions(question.options),
        answer: parseAnswerKey(question.answer),
        explanation: question.explanation,
        points: question.points,
        groupId: question.groupId,
        meta: (question.meta as Record<string, unknown> | null) ?? null,
      })),
    })),
  };
}

/** Learner-safe test: identical minus answer keys and explanations. */
export async function getPublicTest(
  testId: string,
  module: ObjectiveModule
): Promise<PublicTest | null> {
  const definition = await loadTestDefinition(testId, module);
  return definition ? toPublicTest(definition) : null;
}

/* --------------------------------------------------------------- attempts */

function bandTableFor(module: ObjectiveModule): readonly BandRange[] | undefined {
  return resolveBandTable(module, env.bandTableOverride);
}

/** Start (or restart) an attempt for the current user. */
export async function startAttempt(params: {
  userId: string;
  testId: string;
  module: ObjectiveModule;
}): Promise<{ attemptId: string } | null> {
  const { userId, testId, module } = params;

  const test = await prisma.test.findFirst({
    where: { id: testId, module, isPublished: true },
    select: { id: true, module: true },
  });
  if (!test) return null;

  const attempt = await prisma.testAttempt.create({
    data: { userId, testId: test.id, module, status: "IN_PROGRESS" },
    select: { id: true },
  });
  return { attemptId: attempt.id };
}

/**
 * Get an existing in-progress attempt for this user and test, or start one.
 *
 * Used by the runner page so a refresh resumes the same attempt instead of
 * piling up rows. Attempts that were left behind long past their time limit are
 * closed as FAILED (abandoned) and a fresh attempt is started.
 */
export async function ensureAttempt(params: {
  userId: string;
  testId: string;
  module: ObjectiveModule;
}): Promise<{ attemptId: string; startedAt: Date } | null> {
  const { userId, testId, module } = params;

  const test = await prisma.test.findFirst({
    where: { id: testId, module, isPublished: true },
    select: { id: true, durationMinutes: true },
  });
  if (!test) return null;

  const durationMinutes = test.durationMinutes || MODULE_DEFAULT_DURATION[module];
  const staleBefore = new Date(Date.now() - (durationMinutes + 10) * 60_000);

  await prisma.testAttempt.updateMany({
    where: { userId, testId, status: "IN_PROGRESS", startedAt: { lt: staleBefore } },
    data: { status: "FAILED" },
  });

  const existing = await prisma.testAttempt.findFirst({
    where: { userId, testId, status: "IN_PROGRESS" },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true },
  });
  if (existing) return { attemptId: existing.id, startedAt: existing.startedAt };

  const created = await prisma.testAttempt.create({
    data: { userId, testId, module, status: "IN_PROGRESS" },
    select: { id: true, startedAt: true },
  });
  return { attemptId: created.id, startedAt: created.startedAt };
}

/** Ownership-scoped attempt lookup. */
export async function getOwnAttempt(userId: string, attemptId: string) {
  return prisma.testAttempt.findFirst({
    where: { id: attemptId, userId },
    include: {
      test: { select: { id: true, title: true, durationMinutes: true, module: true } },
      answers: true,
    },
  });
}

/**
 * Persist a batch of answers for an in-progress attempt.
 * Graded attempts are immutable: late writes are ignored.
 */
export async function saveAnswers(params: {
  userId: string;
  attemptId: string;
  responses: ResponseMap;
}): Promise<{ saved: number } | null> {
  const { userId, attemptId, responses } = params;

  const attempt = await prisma.testAttempt.findFirst({
    where: { id: attemptId, userId },
    include: { test: { include: { sections: { include: { questions: { select: { id: true } } } } } } },
  });
  if (!attempt || attempt.status !== "IN_PROGRESS") return null;

  const validQuestionIds = new Set(
    attempt.test.sections.flatMap((section) => section.questions.map((q) => q.id))
  );

  const entries = Object.entries(responses).filter(([questionId]) => validQuestionIds.has(questionId));

  await prisma.$transaction(
    entries.map(([questionId, value]) =>
      prisma.testAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId } },
        update: { response: (value ?? null) as Prisma.InputJsonValue },
        create: {
          attemptId,
          questionId,
          response: (value ?? null) as Prisma.InputJsonValue,
        },
      })
    )
  );

  return { saved: entries.length };
}

export interface AttemptSubmissionResult {
  attemptId: string;
  status: "GRADED" | "FAILED";
  rawScore: number;
  maxScore: number;
  totalQuestions: number;
  correctCount: number;
  band: number;
  percentage: number;
  timeSpentSeconds: number | null;
}

/**
 * Grade an attempt. Answers already saved by autosave are merged with the
 * final snapshot from the client (the snapshot wins), everything is scored on
 * the server against the stored answer key, and confidence is never delegated
 * to the browser.
 */
export async function submitAttempt(params: {
  userId: string;
  attemptId: string;
  responses?: ResponseMap;
}): Promise<AttemptSubmissionResult | null> {
  const { userId, attemptId, responses } = params;

  const attempt = await prisma.testAttempt.findFirst({
    where: { id: attemptId, userId },
    include: {
      answers: true,
      test: {
        include: {
          sections: { orderBy: { order: "asc" }, include: { questions: { orderBy: { order: "asc" } } } },
        },
      },
    },
  });
  if (!attempt) return null;

  // `module` is a reserved name in the Next.js lint config, hence testModule.
  const testModule = attempt.module as ObjectiveModule;

  const questions: QuestionDefinition[] = attempt.test.sections.flatMap((section) =>
    section.questions.map((question) => ({
      id: question.id,
      number: question.number,
      order: question.order,
      type: question.type as QuestionType,
      prompt: question.prompt,
      options: parseOptions(question.options),
      answer: parseAnswerKey(question.answer),
      explanation: question.explanation,
      points: question.points,
      groupId: question.groupId,
      meta: (question.meta as Record<string, unknown> | null) ?? null,
    }))
  );

  const merged: ResponseMap = {};
  for (const answer of attempt.answers) {
    merged[answer.questionId] = answer.response as string | string[] | null;
  }
  if (responses) {
    for (const [questionId, value] of Object.entries(responses)) {
      merged[questionId] = value;
    }
  }

  const scored = scoreAttempt({
    module: testModule,
    questions,
    responses: merged,
    bandTable: bandTableFor(testModule),
  });

  const submittedAt = new Date();
  const startedAt = attempt.startedAt;
  const timeSpentSeconds = Math.max(0, Math.round((submittedAt.getTime() - startedAt.getTime()) / 1000));
  const durationLimitSeconds =
    (attempt.test.durationMinutes || MODULE_DEFAULT_DURATION[testModule]) * 60;

  await prisma.$transaction([
    // Persist the graded answers (response + outcome) for the result page.
    ...scored.perQuestion.map((item) =>
      prisma.testAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: item.questionId } },
        update: {
          response: (item.given ?? null) as Prisma.InputJsonValue,
          isCorrect: item.correct,
          awardedPoints: item.awardedPoints,
        },
        create: {
          attemptId,
          questionId: item.questionId,
          response: (item.given ?? null) as Prisma.InputJsonValue,
          isCorrect: item.correct,
          awardedPoints: item.awardedPoints,
        },
      })
    ),
    prisma.testAttempt.update({
      where: { id: attemptId },
      data: {
        status: "GRADED",
        submittedAt,
        timeSpentSeconds: Math.min(timeSpentSeconds, durationLimitSeconds),
        rawScore: scored.rawScore,
        maxScore: scored.maxScore,
        band: scored.band,
      },
    }),
  ]);

  return {
    attemptId,
    status: "GRADED",
    rawScore: scored.rawScore,
    maxScore: scored.maxScore,
    totalQuestions: scored.totalQuestions,
    correctCount: scored.correctCount,
    band: scored.band,
    percentage: scored.percentage,
    timeSpentSeconds: Math.min(timeSpentSeconds, durationLimitSeconds),
  };
}

/* ---------------------------------------------------------------- results */

export interface AttemptQuestionReview {
  questionId: string;
  number: number;
  type: QuestionType;
  prompt: string;
  groupId: string | null;
  given: string | string[] | null;
  correctAnswers: string[];
  isCorrect: boolean;
  awardedPoints: number;
  points: number;
  explanation: string | null;
}

export interface AttemptResult {
  attemptId: string;
  module: ObjectiveModule;
  testId: string;
  testTitle: string;
  status: string;
  startedAt: Date;
  submittedAt: Date | null;
  timeSpentSeconds: number | null;
  rawScore: number;
  maxScore: number;
  totalQuestions: number;
  correctCount: number;
  band: number;
  percentage: number;
  review: AttemptQuestionReview[];
  scoresBySection: Array<{ sectionId: string; title: string; correct: number; total: number }>;
}

/**
 * Full result for the owner only. The answer key and explanations are revealed
 * here because grading has already happened.
 */
export async function getOwnAttemptResult(
  userId: string,
  attemptId: string
): Promise<AttemptResult | null> {
  const attempt = await prisma.testAttempt.findFirst({
    where: { id: attemptId, userId },
    include: {
      answers: true,
      test: {
        include: {
          sections: {
            orderBy: { order: "asc" },
            include: { questions: { orderBy: { order: "asc" } } },
          },
        },
      },
    },
  });
  if (!attempt) return null;

  const testModule = attempt.module as ObjectiveModule;
  const answered = new Map(attempt.answers.map((a) => [a.questionId, a]));

  const review: AttemptQuestionReview[] = [];
  const scoresBySection: AttemptResult["scoresBySection"] = [];

  for (const section of attempt.test.sections) {
    let correct = 0;
    for (const question of section.questions) {
      const answerRow = answered.get(question.id);
      if (answerRow?.isCorrect) correct += 1;
      review.push({
        questionId: question.id,
        number: question.number,
        type: question.type as QuestionType,
        prompt: question.prompt,
        groupId: question.groupId,
        given: (answerRow?.response as string | string[] | null) ?? null,
        correctAnswers: parseAnswerKey(question.answer).answers,
        isCorrect: Boolean(answerRow?.isCorrect),
        awardedPoints: answerRow?.awardedPoints ?? 0,
        points: question.points,
        explanation: question.explanation,
      });
    }
    scoresBySection.push({
      sectionId: section.id,
      title: section.title,
      correct,
      total: section.questions.length,
    });
  }

  review.sort((a, b) => a.number - b.number);

  const maxScore = attempt.maxScore ?? review.reduce((sum, r) => sum + r.points, 0);
  const rawScore = attempt.rawScore ?? review.reduce((sum, r) => sum + r.awardedPoints, 0);
  const correctCount = review.filter((r) => r.isCorrect).length;

  return {
    attemptId: attempt.id,
    module: testModule,
    testId: attempt.testId,
    testTitle: attempt.test.title,
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    timeSpentSeconds: attempt.timeSpentSeconds,
    rawScore,
    maxScore,
    totalQuestions: review.length,
    correctCount,
    band: attempt.band ?? 0,
    percentage: review.length ? Math.round((correctCount / review.length) * 100) : 0,
    review,
    scoresBySection,
  };
}

/* --------------------------------------------------------------- progress */

export interface ModuleProgress {
  module: ObjectiveModule;
  attempts: number;
  latestBand: number | null;
  previousBand: number | null;
  bestBand: number | null;
  averageBand: number | null;
  improvement: number | null;
  history: Array<{
    attemptId: string;
    testId: string;
    testTitle: string;
    band: number;
    rawScore: number;
    maxScore: number;
    date: string;
  }>;
}

export async function getModuleProgress(
  userId: string,
  module: ObjectiveModule
): Promise<ModuleProgress> {
  const attempts = await prisma.testAttempt.findMany({
    where: { userId, module, status: "GRADED" },
    orderBy: { createdAt: "asc" },
    include: { test: { select: { id: true, title: true } } },
  });

  const bands = attempts.map((a) => a.band ?? 0);
  const latest = bands.length ? bands[bands.length - 1] : null;
  const previous = bands.length > 1 ? bands[bands.length - 2] : null;

  return {
    module,
    attempts: attempts.length,
    latestBand: latest,
    previousBand: previous,
    bestBand: bands.length ? Math.max(...bands) : null,
    averageBand: bands.length
      ? Math.round((bands.reduce((a, b) => a + b, 0) / bands.length) * 10) / 10
      : null,
    improvement: latest != null && previous != null ? Math.round((latest - previous) * 10) / 10 : null,
    history: attempts.map((a) => ({
      attemptId: a.id,
      testId: a.test.id,
      testTitle: a.test.title,
      band: a.band ?? 0,
      rawScore: a.rawScore ?? 0,
      maxScore: a.maxScore ?? 0,
      date: (a.submittedAt ?? a.createdAt).toISOString(),
    })),
  };
}

/** All graded attempts for a user, newest first (dashboard history). */
export async function listOwnAttempts(userId: string, module?: ObjectiveModule) {
  return prisma.testAttempt.findMany({
    where: { userId, status: "GRADED", ...(module ? { module } : {}) },
    orderBy: { submittedAt: "desc" },
    include: { test: { select: { id: true, title: true, module: true } } },
  });
}

/** `options` is stored as JSON; expose a typed, validated view. */
function parseOptions(value: unknown): QuestionDefinition["options"] {
  if (!Array.isArray(value)) return null;
  const options = value
    .filter((o): o is { value: unknown; label: unknown } => typeof o === "object" && o !== null)
    .map((o) => ({ value: String(o.value), label: String(o.label) }));
  return options.length ? options : null;
}

/** Question count for a test — used to size timers and progress UI. */
export async function countTestQuestions(testId: string): Promise<number> {
  return prisma.testQuestion.count({ where: { section: { testId } } });
}

/** Full question list for a test definition (helper for tests/tools). */
export function questionsOf(definition: TestDefinition): QuestionDefinition[] {
  return flattenQuestions(definition);
}
