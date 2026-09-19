import { describe, it, expect } from "vitest";
import { writingGradingResponseSchema, bandScoreSchema } from "@/lib/ai/schema";

const validResponse = {
  scores: {
    taskResponse: { band: 6.5, note: "Addresses all parts of the task." },
    coherenceCohesion: { band: 6.0, note: "Clear progression." },
    lexicalResource: { band: 6.5, note: "Good range." },
    grammar: { band: 6.0, note: "Some errors." },
  },
  summary: "A solid essay overall.",
  strengths: ["Clear position"],
  weaknesses: ["Repetitive vocabulary"],
  improvements: ["Practice complex sentences"],
  errors: [
    {
      category: "grammar",
      originalText: "peoples is happy",
      correction: "people are happy",
      explanation: "Subject-verb agreement.",
    },
  ],
};

describe("bandScoreSchema", () => {
  it("accepts 0.5 steps within 0-9", () => {
    for (const v of [0, 0.5, 5, 6.5, 9]) {
      expect(bandScoreSchema.safeParse(v).success).toBe(true);
    }
  });

  it("rejects invalid values", () => {
    for (const v of [-0.5, 9.5, 6.3, 7.25]) {
      expect(bandScoreSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe("writingGradingResponseSchema", () => {
  it("accepts a valid response", () => {
    expect(writingGradingResponseSchema.safeParse(validResponse).success).toBe(true);
  });

  it("rejects missing criteria", () => {
    const broken = { ...validResponse, scores: { taskResponse: validResponse.scores.taskResponse } };
    expect(writingGradingResponseSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects invalid error category", () => {
    const broken = {
      ...validResponse,
      errors: [{ ...validResponse.errors[0], category: "invented-category" }],
    };
    expect(writingGradingResponseSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects empty strengths", () => {
    const broken = { ...validResponse, strengths: [] };
    expect(writingGradingResponseSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects out-of-step band scores", () => {
    const broken = {
      ...validResponse,
      scores: {
        ...validResponse.scores,
        grammar: { band: 6.3, note: "invalid step" },
      },
    };
    expect(writingGradingResponseSchema.safeParse(broken).success).toBe(false);
  });
});

describe("error deduplication fields (V2)", () => {
  it("accepts frequency and isSystematic", () => {
    const parsed = writingGradingResponseSchema.safeParse({
      ...validResponse,
      errors: [{ ...validResponse.errors[0], frequency: 4, isSystematic: true }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a response without them (V1 compatibility)", () => {
    expect(writingGradingResponseSchema.safeParse(validResponse).success).toBe(true);
  });

  it("rejects a frequency below 1", () => {
    const broken = {
      ...validResponse,
      errors: [{ ...validResponse.errors[0], frequency: 0 }],
    };
    expect(writingGradingResponseSchema.safeParse(broken).success).toBe(false);
  });

  it("allows an empty error list (no invented errors)", () => {
    expect(writingGradingResponseSchema.safeParse({ ...validResponse, errors: [] }).success).toBe(true);
  });

  it("rejects more than 15 errors (user must not be flooded)", () => {
    const broken = {
      ...validResponse,
      errors: Array.from({ length: 16 }, (_, i) => ({
        ...validResponse.errors[0],
        originalText: `fragment ${i}`,
      })),
    };
    expect(writingGradingResponseSchema.safeParse(broken).success).toBe(false);
  });
});

describe("informational overall field", () => {
  it("is accepted but optional and must be a valid band when present", () => {
    expect(writingGradingResponseSchema.safeParse({ ...validResponse, overall: 7 }).success).toBe(true);
    expect(writingGradingResponseSchema.safeParse(validResponse).success).toBe(true);
    expect(writingGradingResponseSchema.safeParse({ ...validResponse, overall: 6.3 }).success).toBe(false);
  });
});
