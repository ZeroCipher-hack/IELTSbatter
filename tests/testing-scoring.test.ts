import { describe, it, expect } from "vitest";
import {
  normalizeTextAnswer,
  normalizeChoiceAnswer,
  isAnswerCorrect,
  isAnswered,
  awardedPoints,
  scoreAttempt,
} from "@/lib/testing/scoring";
import type { QuestionDefinition } from "@/lib/testing/types";

function q(overrides: Partial<QuestionDefinition> = {}): QuestionDefinition {
  return {
    id: "q1",
    number: 1,
    order: 1,
    type: "MULTIPLE_CHOICE",
    prompt: "Choose the correct answer.",
    options: [
      { value: "A", label: "First" },
      { value: "B", label: "Second" },
    ],
    answer: { answers: ["B"] },
    points: 1,
    ...overrides,
  };
}

describe("normalisation", () => {
  it("normalises text answers case/whitespace/punctuation-insensitively", () => {
    expect(normalizeTextAnswer("  The   British Museum.  ")).toBe("the british museum");
    expect(normalizeTextAnswer("\u201cLondon\u201d")).toBe("london");
    expect(normalizeTextAnswer("1850")).toBe("1850");
  });

  it("normalises choice answers across spacing and separator spelling", () => {
    expect(normalizeChoiceAnswer("Not Given")).toBe("notgiven");
    expect(normalizeChoiceAnswer("NOT_GIVEN")).toBe("notgiven");
    expect(normalizeChoiceAnswer(" not-given ")).toBe("notgiven");
    expect(normalizeChoiceAnswer("B")).toBe("b");
  });

  it("respects a caseSensitive answer key when asked", () => {
    const question = q({ type: "SHORT_ANSWER", answer: { answers: ["NATO"], caseSensitive: true } });
    expect(isAnswerCorrect(question, "NATO")).toBe(true);
    expect(isAnswerCorrect(question, "nato")).toBe(false);
  });
});

describe("isAnswerCorrect per question type", () => {
  it("multiple choice", () => {
    expect(isAnswerCorrect(q(), "B")).toBe(true);
    expect(isAnswerCorrect(q(), "b")).toBe(true);
    expect(isAnswerCorrect(q(), "A")).toBe(false);
  });

  it("true/false/not given", () => {
    const question = q({ type: "TRUE_FALSE_NOT_GIVEN", answer: { answers: ["NOT GIVEN"] } });
    expect(isAnswerCorrect(question, "NOT GIVEN")).toBe(true);
    expect(isAnswerCorrect(question, "NOT_GIVEN")).toBe(true);
    expect(isAnswerCorrect(question, "FALSE")).toBe(false);
  });

  it("yes/no/not given", () => {
    const question = q({ type: "YES_NO_NOT_GIVEN", answer: { answers: ["YES"] } });
    expect(isAnswerCorrect(question, "yes")).toBe(true);
    expect(isAnswerCorrect(question, "NO")).toBe(false);
  });

  it("matching accepts the stored roman numeral", () => {
    const question = q({ type: "MATCHING", answer: { answers: ["iii"] } });
    expect(isAnswerCorrect(question, "iii")).toBe(true);
    expect(isAnswerCorrect(question, "III")).toBe(true);
    expect(isAnswerCorrect(question, "ii")).toBe(false);
  });

  it("sentence completion accepts any alternative and ignores punctuation", () => {
    const question = q({
      type: "SENTENCE_COMPLETION",
      answer: { answers: ["carbon dioxide", "CO2"] },
    });
    expect(isAnswerCorrect(question, "carbon dioxide")).toBe(true);
    expect(isAnswerCorrect(question, "  Carbon   Dioxide ")).toBe(true);
    expect(isAnswerCorrect(question, "co2")).toBe(true);
    expect(isAnswerCorrect(question, "oxygen")).toBe(false);
  });

  it("short answer", () => {
    const question = q({ type: "SHORT_ANSWER", answer: { answers: ["1998"] } });
    expect(isAnswerCorrect(question, "1998")).toBe(true);
    expect(isAnswerCorrect(question, "1999")).toBe(false);
  });

  it("treats empty, whitespace and missing responses as wrong", () => {
    for (const value of ["", "   ", null, undefined]) {
      expect(isAnswered(value)).toBe(false);
      expect(isAnswerCorrect(q(), value)).toBe(false);
    }
    expect(isAnswered([])).toBe(false);
    expect(isAnswerCorrect(q(), [])).toBe(false);
  });

  it("compares multi-value responses as sets", () => {
    const question = q({ type: "MULTIPLE_CHOICE", answer: { answers: ["A", "C"] } });
    expect(isAnswerCorrect(question, ["A", "C"])).toBe(true);
    expect(isAnswerCorrect(question, ["C", "A"])).toBe(true);
    expect(isAnswerCorrect(question, ["A"])).toBe(false);
    expect(isAnswerCorrect(question, ["A", "B"])).toBe(false);
  });
});

describe("scoreAttempt", () => {
  const questions: QuestionDefinition[] = [
    q({ id: "q1", number: 1, answer: { answers: ["B"] } }),
    q({
      id: "q2",
      number: 2,
      type: "TRUE_FALSE_NOT_GIVEN",
      answer: { answers: ["TRUE"] },
    }),
    q({ id: "q3", number: 3, type: "SHORT_ANSWER", answer: { answers: ["London"] } }),
    q({ id: "q4", number: 4, type: "MATCHING", answer: { answers: ["ii"] } }),
  ];

  it("counts correct answers, raw score and band", () => {
    const scored = scoreAttempt({
      module: "READING",
      questions,
      responses: { q1: "B", q2: "TRUE", q3: "london", q4: "iii" },
    });

    expect(scored.correctCount).toBe(3);
    expect(scored.rawScore).toBe(3);
    expect(scored.maxScore).toBe(4);
    expect(scored.totalQuestions).toBe(4);
    // 3/4 scaled to 40 = 30 -> band 7.0 on the reading table
    expect(scored.band).toBe(7.0);
    expect(scored.percentage).toBe(75);
  });

  it("reports per-question detail for the result page", () => {
    const scored = scoreAttempt({
      module: "READING",
      questions,
      responses: { q1: "A", q2: "TRUE" },
    });

    const byId = Object.fromEntries(scored.perQuestion.map((p) => [p.questionId, p]));
    expect(byId.q1).toMatchObject({ correct: false, awardedPoints: 0, given: "A" });
    expect(byId.q2).toMatchObject({ correct: true, awardedPoints: 1, given: "TRUE" });
    expect(byId.q3).toMatchObject({ correct: false, given: null });
  });

  it("handles an empty attempt without crashing", () => {
    const scored = scoreAttempt({ module: "LISTENING", questions: [], responses: {} });
    expect(scored.correctCount).toBe(0);
    expect(scored.maxScore).toBe(0);
    expect(scored.band).toBe(0);
    expect(scored.percentage).toBe(0);
  });

  it("returns questions in number order regardless of input order", () => {
    const shuffled = [questions[3], questions[0], questions[2], questions[1]];
    const scored = scoreAttempt({ module: "READING", questions: shuffled, responses: {} });
    expect(scored.perQuestion.map((p) => p.number)).toEqual([1, 2, 3, 4]);
  });

  it("honours multi-point questions", () => {
    const weighted = [q({ id: "w1", number: 1, answer: { answers: ["B"] }, points: 2 })];
    const scored = scoreAttempt({ module: "READING", questions: weighted, responses: { w1: "B" } });
    expect(scored.rawScore).toBe(2);
    expect(scored.maxScore).toBe(2);
    // Band uses correct-answer count, not points.
    expect(scored.band).toBe(9);
  });

  it("accepts a custom band table", () => {
    const scored = scoreAttempt({
      module: "READING",
      questions,
      responses: { q1: "B", q2: "TRUE", q3: "london", q4: "ii" },
      bandTable: [{ min: 0, band: 5.5 }],
    });
    expect(scored.band).toBe(5.5);
  });
});

describe("awardedPoints", () => {
  it("awards the question weight only when correct", () => {
    const question = q({ points: 3 });
    expect(awardedPoints(question, "B")).toBe(3);
    expect(awardedPoints(question, "A")).toBe(0);
  });
});
