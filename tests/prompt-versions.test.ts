/**
 * Prompt versioning guarantees: V1 stays frozen, V2 carries the calibrated
 * examiner rules, and the active version is env-driven (never hardcoded).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  WRITING_GRADING_PROMPT_V1,
  WRITING_GRADING_PROMPT_V2,
  DEFAULT_WRITING_PROMPT_VERSION,
  buildWritingGradingPromptV1,
  buildWritingGradingPromptV2,
  buildWritingGradingPromptForVersion,
  promptLabel,
  promptVersionFromLabel,
} from "@/lib/ai/prompts";

const params = {
  question: "Discuss both views and give your own opinion.",
  essay: "Some essay text for the prompt.",
  feedbackLocale: "uz",
};

describe("prompt registry", () => {
  it("keeps V1 and V2 as distinct, immutable identifiers", () => {
    expect(WRITING_GRADING_PROMPT_V1).toBe("WRITING_GRADING_PROMPT_V1");
    expect(WRITING_GRADING_PROMPT_V2).toBe("WRITING_GRADING_PROMPT_V2");
    expect(DEFAULT_WRITING_PROMPT_VERSION).toBe(WRITING_GRADING_PROMPT_V2);
  });

  it("maps labels to stored versions", () => {
    expect(promptVersionFromLabel("V1")).toBe(WRITING_GRADING_PROMPT_V1);
    expect(promptVersionFromLabel("v2")).toBe(WRITING_GRADING_PROMPT_V2);
    expect(promptVersionFromLabel("anything")).toBe(WRITING_GRADING_PROMPT_V2);
    expect(promptLabel(WRITING_GRADING_PROMPT_V2)).toBe("V2");
    expect(promptLabel("LEGACY")).toBe("UNKNOWN");
  });
});

describe("V1 prompt (frozen)", () => {
  const v1 = buildWritingGradingPromptV1(params);

  it("still contains its original calibration rules", () => {
    expect(v1).toContain("certified IELTS Writing examiner");
    expect(v1).toContain("Do not inflate scores to be kind");
    expect(v1).toContain("Return exactly this JSON shape");
  });

  it("does not gain V2-only sections", () => {
    expect(v1).not.toContain("NO SYCOPHANCY");
    expect(v1).not.toContain("STEP 1 — ASSESS EACH CRITERION INDEPENDENTLY");
  });
});

describe("V2 prompt (calibrated)", () => {
  const v2 = buildWritingGradingPromptV2(params);

  it("declares the anti-sycophancy / anti-inflation rules", () => {
    expect(v2).toContain("NO SYCOPHANCY");
    expect(v2).toContain("NO SCORE INFLATION");
    expect(v2).toContain("NO INVENTED EVIDENCE");
    expect(v2).toContain("NO SCORE DEFLATION");
  });

  it("asks for independent per-criterion assessment before justification", () => {
    expect(v2).toContain("STEP 1 — ASSESS EACH CRITERION INDEPENDENTLY");
    expect(v2).toContain("STEP 2 — JUSTIFY");
    expect(v2).toContain("INFORMATIONAL ONLY");
  });

  it("covers every Task Response checkpoint", () => {
    for (const checkpoint of [
      "question requirements",
      "position",
      "main ideas",
      "explanation",
      "examples",
      "relevance",
      "development",
    ]) {
      expect(v2.toLowerCase()).toContain(checkpoint);
    }
  });

  it("covers every Coherence & Cohesion checkpoint", () => {
    for (const checkpoint of [
      "paragraphing",
      "logical progression",
      "cohesion",
      "referencing",
      "linking devices",
      "unnecessary repetition",
    ]) {
      expect(v2.toLowerCase()).toContain(checkpoint);
    }
  });

  it("covers every Lexical Resource checkpoint", () => {
    for (const checkpoint of [
      "range",
      "precision",
      "collocation",
      "repetition",
      "word choice",
      "appropriacy",
    ]) {
      expect(v2.toLowerCase()).toContain(checkpoint);
    }
  });

  it("covers every Grammar checkpoint", () => {
    for (const checkpoint of [
      "sentence variety",
      "complex structures",
      "accuracy",
      "punctuation",
      "repeated error patterns",
    ]) {
      expect(v2.toLowerCase()).toContain(checkpoint);
    }
  });

  it("bounds the error list and de-duplicates repeated errors", () => {
    expect(v2).toContain("Maximum 10 entries overall");
    expect(v2).toContain("frequency");
    expect(v2).toContain("isSystematic");
    expect(v2).toContain("Never invent errors");
  });

  it("carries the question and essay verbatim and requests the UI language", () => {
    expect(v2).toContain(params.question);
    expect(v2).toContain(params.essay);
    expect(v2).toContain("Uzbek");

    const ru = buildWritingGradingPromptV2({ ...params, feedbackLocale: "ru" });
    expect(ru).toContain("Russian");
    expect(ru).not.toContain("in Uzbek");
  });

  it("is selected by buildWritingGradingPromptForVersion", () => {
    expect(buildWritingGradingPromptForVersion("WRITING_GRADING_PROMPT_V1", params)).toBe(
      buildWritingGradingPromptV1(params)
    );
    expect(buildWritingGradingPromptForVersion("WRITING_GRADING_PROMPT_V2", params)).toBe(
      buildWritingGradingPromptV2(params)
    );
  });
});

describe("AI_PROMPT_VERSION env switch", () => {
  const original = process.env.AI_PROMPT_VERSION;

  beforeEach(() => {
    delete process.env.AI_PROMPT_VERSION;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AI_PROMPT_VERSION;
    else process.env.AI_PROMPT_VERSION = original;
  });

  it("defaults to V2", async () => {
    const { env } = await import("@/lib/env");
    expect(env.aiPromptVersion).toBe("V2");
  });

  it("accepts short and full V1 spellings", async () => {
    const { env } = await import("@/lib/env");
    process.env.AI_PROMPT_VERSION = "V1";
    expect(env.aiPromptVersion).toBe("V1");
    process.env.AI_PROMPT_VERSION = "WRITING_GRADING_PROMPT_V1";
    expect(env.aiPromptVersion).toBe("V1");
  });
});
