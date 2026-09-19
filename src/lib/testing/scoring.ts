/**
 * Objective scoring engine for Reading and Listening.
 *
 * The answer key lives in the database (`TestQuestion.answer`) and grading is
 * pure, deterministic and server-side — no AI is involved in scoring.
 * Every question type is reduced to "accepted answers vs normalised response",
 * so adding a new type means adding a normaliser, not a new grading path.
 */
import { TEXT_ANSWER_TYPES, type QuestionDefinition, type ResponseMap } from "./types";
import {
  rawToBand,
  scorePercentage,
  type BandRange,
  type ScoredAttempt,
  type TestModule,
} from "./band-conversion";

/**
 * Normalise a text answer the way IELTS markers do: ignore case, ignore
 * leading/trailing and repeated whitespace, ignore a trailing full stop and
 * optional surrounding quotes.
 */
export function normalizeTextAnswer(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.]$/, "")
    .trim();
}

/** Normalise a choice answer: "Not Given" === "NOT_GIVEN" === "notgiven". */
export function normalizeChoiceAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function normalizeAnswer(value: string, question: QuestionDefinition): string {
  if (TEXT_ANSWER_TYPES.includes(question.type)) {
    return question.answer.caseSensitive ? value.trim() : normalizeTextAnswer(value);
  }
  return normalizeChoiceAnswer(value);
}

/** A response is answered when it holds at least one non-empty value. */
export function isAnswered(value: string | string[] | null | undefined): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some((v) => typeof v === "string" && v.trim().length > 0);
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Compare one response against the stored answer key.
 * Multi-value responses (future multi-select questions) compare as sets.
 */
export function isAnswerCorrect(
  question: QuestionDefinition,
  response: string | string[] | null | undefined
): boolean {
  const accepted = question.answer.answers.map((a) => normalizeAnswer(a, question));
  if (accepted.length === 0) return false;

  if (Array.isArray(response)) {
    const given = response.filter((v) => typeof v === "string" && v.trim().length > 0);
    if (given.length === 0) return false;
    const normalizedValues = given.map((v) => normalizeAnswer(v, question));
    const normalizedGiven = new Set(normalizedValues);
    // Duplicating one choice must not satisfy a multi-answer question or hide
    // an invalid client payload behind set de-duplication.
    if (normalizedGiven.size !== normalizedValues.length) return false;
    // Every accepted answer must be present and nothing extra claimed.
    return (
      normalizedGiven.size === accepted.length && accepted.every((a) => normalizedGiven.has(a))
    );
  }

  if (typeof response !== "string" || response.trim().length === 0) return false;
  return accepted.includes(normalizeAnswer(response, question));
}

/** Points awarded for one question (0 when wrong). */
export function awardedPoints(
  question: QuestionDefinition,
  response: string | string[] | null | undefined
): number {
  return isAnswerCorrect(question, response) ? Math.max(1, question.points ?? 1) : 0;
}

/**
 * Score a whole attempt. `questions` must already be scoped to the attempt's
 * test, and `responses` maps questionId -> learner response.
 */
export function scoreAttempt(params: {
  module: TestModule;
  questions: QuestionDefinition[];
  responses: ResponseMap;
  bandTable?: readonly BandRange[];
}): ScoredAttempt {
  const { module, questions, responses, bandTable } = params;

  const perQuestion = questions
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((question) => {
      const response = responses[question.id];
      const points = awardedPoints(question, response);
      return {
        questionId: question.id,
        number: question.number,
        correct: points > 0,
        awardedPoints: points,
        given: response ?? null,
      };
    });

  const rawScore = perQuestion.reduce((sum, q) => sum + q.awardedPoints, 0);
  const maxScore = questions.reduce((sum, q) => sum + Math.max(1, q.points ?? 1), 0);
  const correctCount = perQuestion.filter((q) => q.correct).length;

  return {
    correctCount,
    rawScore,
    maxScore,
    totalQuestions: questions.length,
    // Bands come from the number of correct answers, matching IELTS practice.
    band: rawToBand(module, correctCount, questions.length, bandTable),
    percentage: scorePercentage(correctCount, questions.length),
    perQuestion,
  };
}

/**
 * Group questions that should be rendered together (matching groups share a
 * groupId and one option list).
 */
export function groupQuestions(questions: QuestionDefinition[]): QuestionDefinition[][] {
  const groups: QuestionDefinition[][] = [];
  const byGroup = new Map<string, QuestionDefinition[]>();

  for (const question of questions.slice().sort((a, b) => a.number - b.number)) {
    if (!question.groupId) {
      groups.push([question]);
      continue;
    }
    const existing = byGroup.get(question.groupId);
    if (existing) existing.push(question);
    else {
      const group = [question];
      byGroup.set(question.groupId, group);
      groups.push(group);
    }
  }

  return groups;
}
