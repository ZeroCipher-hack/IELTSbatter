/**
 * Shared test-engine types.
 *
 * Reading, Listening and the Speaking question bank all speak this shape, so
 * the UI components, the scoring engine and the authoring service stay
 * independent of any particular module.
 */

export const QUESTION_TYPES = [
  "MULTIPLE_CHOICE",
  "TRUE_FALSE_NOT_GIVEN",
  "YES_NO_NOT_GIVEN",
  "MATCHING",
  "SENTENCE_COMPLETION",
  "SHORT_ANSWER",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Question types whose answers are free text (normalised before comparing). */
export const TEXT_ANSWER_TYPES: QuestionType[] = ["SENTENCE_COMPLETION", "SHORT_ANSWER"];

/** Question types answered by picking one of a fixed option list. */
export const CHOICE_ANSWER_TYPES: QuestionType[] = [
  "MULTIPLE_CHOICE",
  "TRUE_FALSE_NOT_GIVEN",
  "YES_NO_NOT_GIVEN",
  "MATCHING",
];

export interface QuestionOption {
  /** Stored/compared value, e.g. "B" or "TRUE" or "iii". */
  value: string;
  /** Text shown to the learner. */
  label: string;
}

/** Canonical answer as persisted on TestQuestion.answer. */
export interface QuestionAnswerKey {
  /** Accepted answers (any of them is correct). */
  answers: string[];
  /** Optional per-question override; defaults to false. */
  caseSensitive?: boolean;
}

export interface QuestionDefinition {
  id: string;
  number: number;
  order: number;
  type: QuestionType;
  prompt: string;
  options?: QuestionOption[] | null;
  answer: QuestionAnswerKey;
  explanation?: string | null;
  points: number;
  groupId?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface SectionDefinition {
  id: string;
  order: number;
  title: string;
  instructions?: string | null;
  /** Reading: passage body. */
  passage?: string | null;
  /** Listening: URL of the audio asset (never binary data). */
  audioUrl?: string | null;
  /** Listening: duration in seconds when known, for the player UI. */
  audioDurationSeconds?: number | null;
  questions: QuestionDefinition[];
}

export interface TestDefinition {
  id: string;
  module: "READING" | "LISTENING" | "SPEAKING";
  title: string;
  description?: string | null;
  durationMinutes: number;
  sections: SectionDefinition[];
}

/**
 * A question as sent to the browser: identical to QuestionDefinition minus the
 * answer key and explanation, which are released only after grading.
 */
export type PublicQuestion = Omit<QuestionDefinition, "answer" | "explanation">;

export interface PublicSection extends Omit<SectionDefinition, "questions"> {
  questions: PublicQuestion[];
}

export interface PublicTest extends Omit<TestDefinition, "sections"> {
  sections: PublicSection[];
}

/** Strip everything a learner must not see before submitting. */
export function toPublicTest(test: TestDefinition): PublicTest {
  return {
    ...test,
    sections: test.sections.map((section) => ({
      ...section,
      questions: section.questions.map(({ answer: _answer, explanation: _explanation, ...rest }) => rest),
    })),
  };
}

/** Total number of questions in a test. */
export function countQuestions(test: TestDefinition): number {
  return test.sections.reduce((sum, s) => sum + s.questions.length, 0);
}

/** Flat list of every question, in test order. */
export function flattenQuestions(test: TestDefinition): QuestionDefinition[] {
  return test.sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((s) => s.questions.slice().sort((a, b) => a.order - b.order));
}

/** A learner's raw response for one question. */
export type AnswerValue = string | string[] | null | undefined;
export type ResponseMap = Record<string, AnswerValue>;
