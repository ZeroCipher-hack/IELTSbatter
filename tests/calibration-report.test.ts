/**
 * The calibration report contract.
 *
 * These tests pin the shape of the measurement output so a real Gemini run
 * always yields everything needed for the report: expected vs AI per criterion,
 * absolute differences, latency, retry count and validation status — plus the
 * per-prompt summary (MAD, bias, exact matches, mean latency).
 */
import { describe, it, expect } from "vitest";
import { accuracyFor, summarize, type RunResult } from "../scripts/calibrate-writing";

const expected = {
  taskResponse: 7.5,
  coherenceCohesion: 7.5,
  lexicalResource: 7.5,
  grammar: 8.0,
};

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    id: "strong",
    words: 300,
    ok: true,
    expected,
    expectedOverall: 7.5,
    actual: {
      taskResponse: 7.0,
      coherenceCohesion: 7.0,
      lexicalResource: 7.5,
      grammar: 7.0,
      overall: 7.0,
    },
    absDiff: {
      taskResponse: 0.5,
      coherenceCohesion: 0.5,
      lexicalResource: 0,
      grammar: 1,
      overall: 0.5,
    },
    signedDiff: {
      taskResponse: -0.5,
      coherenceCohesion: -0.5,
      lexicalResource: 0,
      grammar: -1,
      overall: -0.5,
    },
    meta: {
      provider: "gemini",
      model: "gemini-1.5-flash",
      promptVersion: "WRITING_GRADING_PROMPT_V2",
      latencyMs: 4000,
      attempts: 2,
      retryCount: 1,
      validationStatus: "VALID",
      validationErrors: [],
      inputTokens: 1500,
      outputTokens: 400,
      warnings: [],
    },
    ...overrides,
  };
}

function failedResult(): RunResult {
  return {
    id: "broken",
    words: 300,
    ok: false,
    error: "schema mismatch",
    meta: {
      provider: "gemini",
      model: "gemini-1.5-flash",
      promptVersion: "WRITING_GRADING_PROMPT_V2",
      latencyMs: 9000,
      attempts: 3,
      retryCount: 2,
      validationStatus: "SCHEMA_MISMATCH",
      validationErrors: ["scores.grammar.band: must be 0.5 steps"],
      inputTokens: null,
      outputTokens: null,
      warnings: [],
    },
  };
}

describe("accuracyFor", () => {
  it("reports every criterion plus the overall band", () => {
    const rows = accuracyFor([result()]);
    expect(rows.map((r) => r.key)).toEqual([
      "Task Response",
      "Coherence & Cohesion",
      "Lexical Resource",
      "Grammar",
      "Overall",
    ]);
  });

  it("computes mean absolute difference, exact matches and signed bias", () => {
    const rows = accuracyFor([
      result(),
      result({ actual: { ...result().actual!, taskResponse: 8.0, overall: 7.5 } }),
    ]);

    const tr = rows.find((r) => r.key === "Task Response")!;
    expect(tr.meanAbsDiff).toBe(0.5); // |7-7.5| and |8-7.5| -> 0.5, 0.5
    expect(tr.exact).toBe(0);
    expect(tr.bias).toBe(0); // -0.5 and +0.5

    const grammar = rows.find((r) => r.key === "Grammar")!;
    expect(grammar.meanAbsDiff).toBe(1); // |7-8|
    expect(grammar.bias).toBe(-1); // model scored below the reference
  });

  it("ignores runs without a reference score", () => {
    const rows = accuracyFor([result({ expected: undefined, expectedOverall: undefined })]);
    expect(rows[0].n).toBe(0);
    expect(Number.isNaN(rows[0].meanAbsDiff)).toBe(true);
  });
});

describe("summarize", () => {
  it("carries MAD, bias, exact matches, latency, retries and validation status", () => {
    const summary = summarize("WRITING_GRADING_PROMPT_V2", [result(), result()], false);

    expect(summary).toMatchObject({
      promptVersion: "WRITING_GRADING_PROMPT_V2",
      model: "gemini-1.5-flash",
      mock: false,
      n: 2,
      overallMeanAbsDiff: 0.5,
      overallMeanSignedBias: -0.5,
      overallExact: 0,
      meanLatencyMs: 4000,
      totalRetries: 2,
      failedRuns: 0,
      validationStatuses: { VALID: 2 },
    });
    expect(summary.criteria).toHaveLength(5);
    expect(summary.criteria[0]).toHaveProperty("meanAbsDiff");
    expect(summary.criteria[0]).toHaveProperty("meanSignedBias");
    expect(summary.criteria[0]).toHaveProperty("exact");
  });

  it("counts failures and keeps the failure validation status", () => {
    const summary = summarize("WRITING_GRADING_PROMPT_V2", [result(), failedResult()], false);

    expect(summary.failedRuns).toBe(1);
    expect(summary.validationStatuses).toEqual({ SCHEMA_MISMATCH: 1, VALID: 1 });
    expect(summary.totalRetries).toBe(3); // 1 + 2
  });

  it("marks mock runs so their numbers are never mistaken for real measurements", () => {
    const summary = summarize("WRITING_GRADING_PROMPT_V2", [result()], true);
    expect(summary.mock).toBe(true);
  });
});
