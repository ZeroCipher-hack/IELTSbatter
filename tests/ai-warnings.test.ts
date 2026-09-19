/**
 * Operator warnings: non-fatal observations stored with each evaluation.
 * They must never change what the user sees and must be deterministic.
 */
import { describe, it, expect } from "vitest";
import {
  computeGradingWarnings,
  GRADING_WARNINGS,
  OVERALL_MISMATCH_THRESHOLD,
} from "@/lib/ai/warnings";
import type { WritingGradingResponse } from "@/lib/ai/schema";

const data = (overrides: Partial<WritingGradingResponse> = {}): WritingGradingResponse =>
  ({
    scores: {
      taskResponse: { band: 6.5, note: "n" },
      coherenceCohesion: { band: 6, note: "n" },
      lexicalResource: { band: 6.5, note: "n" },
      grammar: { band: 6, note: "n" },
    },
    summary: "s",
    strengths: ["s"],
    weaknesses: ["w"],
    improvements: ["i"],
    errors: [],
    ...overrides,
  }) as WritingGradingResponse;

const base = {
  overall: 6.5,
  rawResponse: "{}",
  wordCount: 300,
  minWords: 250,
};

describe("computeGradingWarnings", () => {
  it("returns no warnings for a clean run", () => {
    expect(computeGradingWarnings({ data: data(), ...base })).toEqual([]);
  });

  it("flags an AI overall that disagrees with the backend computation", () => {
    expect(computeGradingWarnings({ data: data({ overall: 9 }), ...base })).toEqual([
      GRADING_WARNINGS.overallMismatch,
    ]);
  });

  it("ignores a disagreement below the threshold", () => {
    expect(computeGradingWarnings({ data: data({ overall: 7 }), ...base })).toEqual([]);
  });

  it("uses the documented threshold", () => {
    const justAt = 6.5 + OVERALL_MISMATCH_THRESHOLD;
    expect(computeGradingWarnings({ data: data({ overall: justAt }), ...base })).toEqual([
      GRADING_WARNINGS.overallMismatch,
    ]);
  });

  it("does not flag a missing informational overall", () => {
    expect(computeGradingWarnings({ data: data(), ...base })).toEqual([]);
  });

  it("flags a truncated raw response", () => {
    expect(computeGradingWarnings({ data: data(), ...base, rawTruncated: true })).toEqual([
      GRADING_WARNINGS.rawTruncated,
    ]);
  });

  it("flags an under-length essay", () => {
    expect(computeGradingWarnings({ data: data(), ...base, wordCount: 200 })).toEqual([
      GRADING_WARNINGS.underlength,
    ]);
  });

  it("flags suspiciously low output tokens", () => {
    expect(computeGradingWarnings({ data: data(), ...base, outputTokens: 12 })).toEqual([
      GRADING_WARNINGS.lowOutputTokens,
    ]);
  });

  it("accumulates independent warnings in a stable order", () => {
    const warnings = computeGradingWarnings({
      data: data({ overall: 4 }),
      ...base,
      wordCount: 100,
      rawTruncated: true,
    });
    expect(warnings).toEqual([
      GRADING_WARNINGS.overallMismatch,
      GRADING_WARNINGS.rawTruncated,
      GRADING_WARNINGS.underlength,
    ]);
  });

  it("never includes essay text or provider detail (metadata only)", () => {
    const warnings = computeGradingWarnings({ data: data({ overall: 2 }), ...base });
    for (const w of warnings) {
      expect(w).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe("provider-level vs evaluation-level split", () => {
  it("provider warnings cover truncation and thin output only", async () => {
    const { computeProviderWarnings } = await import("@/lib/ai/warnings");
    expect(computeProviderWarnings({})).toEqual([]);
    expect(computeProviderWarnings({ rawTruncated: true })).toEqual([GRADING_WARNINGS.rawTruncated]);
    expect(computeProviderWarnings({ outputTokens: 4 })).toEqual([GRADING_WARNINGS.lowOutputTokens]);
  });

  it("evaluation warnings are provider-agnostic", async () => {
    const { computeEvaluationWarnings } = await import("@/lib/ai/warnings");
    expect(
      computeEvaluationWarnings({ data: data({ overall: 3 }), overall: 6.5, wordCount: 120, minWords: 250 })
    ).toEqual([GRADING_WARNINGS.overallMismatch, GRADING_WARNINGS.underlength]);
  });

  it("merges without duplicates and in a stable order", async () => {
    const { mergeWarnings } = await import("@/lib/ai/warnings");
    expect(
      mergeWarnings(
        [GRADING_WARNINGS.lowOutputTokens, GRADING_WARNINGS.underlength],
        [GRADING_WARNINGS.underlength, GRADING_WARNINGS.overallMismatch]
      )
    ).toEqual([
      GRADING_WARNINGS.overallMismatch,
      GRADING_WARNINGS.underlength,
      GRADING_WARNINGS.lowOutputTokens,
    ]);
  });
});
