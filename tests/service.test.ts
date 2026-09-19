/**
 * Integration tests for the writing service against a real PostgreSQL
 * database (uses DATABASE_URL). The AI provider is mocked/injected so no
 * external API is ever called.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { setGraderForTesting } from "@/lib/ai/grading";
import { AIGradingError } from "@/lib/ai/gemini";
import { MockGrader } from "@/lib/ai/mock";
import { finalizeGradingResult } from "@/lib/ai/result";
import type { AIGrader, GradingMeta, WritingGradingResponse } from "@/lib/ai/schema";
import { submitAndGradeEssay, getOwnSubmission, getSubmissionAiEvaluations } from "@/lib/writing/service";

process.env.DATABASE_URL ??= "postgresql://axi:axi@localhost:5432/axi";

const essay = Array(260).fill("test").join(" ");
const question = "Some people believe testing is great. Discuss both views.";

let userA: { id: string };
let userB: { id: string };

beforeAll(async () => {
  setGraderForTesting(new MockGrader());
  const suffix = Date.now();
  userA = await prisma.user.create({
    data: { phone: `+99890${suffix % 10000000}`, name: "Test A", passwordHash: "x" },
  });
  userB = await prisma.user.create({
    data: { phone: `+99891${suffix % 10000000}`, name: "Test B", passwordHash: "x" },
  });
});

beforeEach(() => {
  setGraderForTesting(new MockGrader());
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  setGraderForTesting(undefined);
  await prisma.$disconnect();
});

/** Minimal valid AI payload for injected test graders. */
function aiPayload(overrides: Partial<WritingGradingResponse> = {}): WritingGradingResponse {
  return {
    scores: {
      taskResponse: { band: 6.5, note: "task note" },
      coherenceCohesion: { band: 6.0, note: "coherence note" },
      lexicalResource: { band: 6.5, note: "lexis note" },
      grammar: { band: 6.0, note: "grammar note" },
    },
    summary: "summary",
    strengths: ["s"],
    weaknesses: ["w"],
    improvements: ["i"],
    errors: [],
    ...overrides,
  } as WritingGradingResponse;
}

function meta(overrides: Partial<GradingMeta> = {}): GradingMeta {
  return {
    provider: "test-provider",
    model: "test-model",
    promptVersion: "WRITING_GRADING_PROMPT_V2",
    rawResponse: "{\"raw\":true}",
    latencyMs: 1234,
    attempts: 1,
    retryCount: 0,
    validationStatus: "VALID",
    validationErrors: [],
    inputTokens: 1000,
    outputTokens: 300,
    ...overrides,
  };
}

function graderReturning(payload: WritingGradingResponse, metaOverrides: Partial<GradingMeta> = {}): AIGrader {
  const metaValue = meta(metaOverrides);
  return {
    provider: metaValue.provider,
    model: metaValue.model,
    promptVersion: metaValue.promptVersion,
    async gradeWriting() {
      return finalizeGradingResult({ data: payload, meta: metaValue });
    },
  };
}

describe("submitAndGradeEssay", () => {
  it("creates submission with score, feedback, errors and raw AI evaluation", async () => {
    const result = await submitAndGradeEssay({
      userId: userA.id,
      input: { question, essay, testType: "TASK_2" },
      feedbackLocale: "uz",
    });

    expect(result.status).toBe("COMPLETED");

    const stored = await prisma.submission.findUnique({
      where: { id: result.submissionId },
      include: { score: true, feedback: true, aiEvaluations: true },
    });
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.wordCount).toBe(260);
    expect(stored?.score?.overall).toBeGreaterThan(0);
    expect(stored?.feedback?.summary.length).toBeGreaterThan(0);
    expect(stored?.aiEvaluations.length).toBe(1);
    expect(stored?.aiEvaluations[0].rawResponse.length).toBeGreaterThan(0);
  });

  it("persists provider, model and the exact prompt version used", async () => {
    setGraderForTesting(graderReturning(aiPayload(), { promptVersion: "WRITING_GRADING_PROMPT_V1" }));

    const { submissionId } = await submitAndGradeEssay({
      userId: userA.id,
      input: { question, essay, testType: "TASK_2" },
      feedbackLocale: "uz",
    });

    const evaluation = (await getSubmissionAiEvaluations(userA.id, submissionId))[0];
    expect(evaluation.promptVersion).toBe("WRITING_GRADING_PROMPT_V1");
    expect(evaluation.provider).toBe("test-provider");
    expect(evaluation.model).toBe("test-model");
    expect(evaluation.success).toBe(true);
  });

  it("persists reliability and cost metadata (attempts, retries, validation, tokens)", async () => {
    setGraderForTesting(
      graderReturning(aiPayload(), {
        attempts: 3,
        retryCount: 2,
        validationStatus: "VALID",
        latencyMs: 5000,
        inputTokens: 2100,
        outputTokens: 640,
      })
    );

    const { submissionId } = await submitAndGradeEssay({
      userId: userA.id,
      input: { question, essay, testType: "TASK_2" },
      feedbackLocale: "uz",
    });

    const evaluation = (await getSubmissionAiEvaluations(userA.id, submissionId))[0];
    expect(evaluation).toMatchObject({
      attempts: 3,
      retryCount: 2,
      validationStatus: "VALID",
      latencyMs: 5000,
      inputTokens: 2100,
      outputTokens: 640,
    });
  });

  it("stores repeated errors once, with frequency and isSystematic", async () => {
    setGraderForTesting(
      graderReturning(
        aiPayload({
          errors: [
            {
              category: "grammar",
              originalText: "people is",
              correction: "people are",
              explanation: "Plural subject",
              frequency: 5,
              isSystematic: true,
            },
            {
              category: "spelling",
              originalText: "enviroment",
              correction: "environment",
              explanation: "Spelling",
            },
          ],
        })
      )
    );

    const { submissionId } = await submitAndGradeEssay({
      userId: userA.id,
      input: { question, essay, testType: "TASK_2" },
      feedbackLocale: "uz",
    });

    const stored = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { errors: { orderBy: { createdAt: "asc" } } },
    });

    expect(stored?.errors).toHaveLength(2);
    expect(stored?.errors[0]).toMatchObject({ frequency: 5, isSystematic: true });
    // Defaults applied when the model omits the optional fields.
    expect(stored?.errors[1]).toMatchObject({ frequency: 1, isSystematic: false });
  });

  it("ignores the AI's own overall value and stores the server-computed band", async () => {
    setGraderForTesting(graderReturning(aiPayload({ overall: 9 })));

    const { submissionId } = await submitAndGradeEssay({
      userId: userA.id,
      input: { question, essay, testType: "TASK_2" },
      feedbackLocale: "uz",
    });

    const stored = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { score: true },
    });
    // (6.5 + 6 + 6.5 + 6) / 4 = 6.25 -> 6.5
    expect(stored?.score?.overall).toBe(6.5);
  });

  it("marks the submission FAILED when the AI provider returns invalid data", async () => {
    const failing: AIGrader = {
      provider: "failing",
      model: "failing-1",
      promptVersion: "WRITING_GRADING_PROMPT_V2",
      async gradeWriting() {
        throw new Error("malformed JSON from provider");
      },
    };
    setGraderForTesting(failing);
    try {
      const result = await submitAndGradeEssay({
        userId: userA.id,
        input: { question, essay, testType: "TASK_2" },
        feedbackLocale: "uz",
      });
      expect(result.status).toBe("FAILED");

      const stored = await prisma.submission.findUnique({
        where: { id: result.submissionId },
        include: { aiEvaluations: true },
      });
      expect(stored?.status).toBe("FAILED");
      expect(stored?.aiEvaluations[0]?.success).toBe(false);
    } finally {
      setGraderForTesting(new MockGrader());
    }
  });

  it("records prompt version, attempts and validation status on the failure row", async () => {
    setGraderForTesting({
      provider: "gemini",
      model: "gemini-test",
      promptVersion: "WRITING_GRADING_PROMPT_V2",
      async gradeWriting() {
        throw new AIGradingError({
          provider: "gemini",
          model: "gemini-test",
          promptVersion: "WRITING_GRADING_PROMPT_V2",
          attempts: 3,
          retryCount: 2,
          latencyMs: 9000,
          validationStatus: "SCHEMA_MISMATCH",
          validationErrors: ["scores.grammar.band: Band score must be in 0.5 steps"],
          rawResponse: "{\"scores\":{\"grammar\":{\"band\":6.3}}}",
          reason: "Band score must be in 0.5 steps",
        });
      },
    });

    const { submissionId } = await submitAndGradeEssay({
      userId: userA.id,
      input: { question, essay, testType: "TASK_2" },
      feedbackLocale: "uz",
    });

    const evaluation = (await getSubmissionAiEvaluations(userA.id, submissionId))[0];
    expect(evaluation).toMatchObject({
      success: false,
      provider: "gemini",
      model: "gemini-test",
      promptVersion: "WRITING_GRADING_PROMPT_V2",
      attempts: 3,
      retryCount: 2,
      validationStatus: "SCHEMA_MISMATCH",
      latencyMs: 9000,
    });
    expect(evaluation.rawResponse).toContain("6.3");
    // Never store a fabricated prompt version on the failure path.
    expect(evaluation.promptVersion).not.toBe("unknown");
  });

  it("keeps the raw AI response available for debugging", async () => {
    setGraderForTesting(
      graderReturning(aiPayload(), { rawResponse: "{\"scores\":\"raw value from provider\"}" })
    );

    const { submissionId } = await submitAndGradeEssay({
      userId: userA.id,
      input: { question, essay, testType: "TASK_2" },
      feedbackLocale: "uz",
    });

    const evaluation = (await getSubmissionAiEvaluations(userA.id, submissionId))[0];
    expect(evaluation.rawResponse).toContain("raw value from provider");
  });
});

describe("authorization: getOwnSubmission", () => {
  it("returns the submission for its owner and null for another user", async () => {
    const { submissionId } = await submitAndGradeEssay({
      userId: userA.id,
      input: { question, essay, testType: "TASK_2" },
      feedbackLocale: "uz",
    });

    const own = await getOwnSubmission(userA.id, submissionId);
    expect(own?.id).toBe(submissionId);

    const foreign = await getOwnSubmission(userB.id, submissionId);
    expect(foreign).toBeNull();
  });

  it("does not expose AI evaluations to other users", async () => {
    const { submissionId } = await submitAndGradeEssay({
      userId: userA.id,
      input: { question, essay, testType: "TASK_2" },
      feedbackLocale: "uz",
    });

    expect(await getSubmissionAiEvaluations(userA.id, submissionId)).toHaveLength(1);
    expect(await getSubmissionAiEvaluations(userB.id, submissionId)).toHaveLength(0);
  });
});

describe("score consistency", () => {
  const originalMode = process.env.AI_MODE;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.AI_MODE;
    else process.env.AI_MODE = originalMode;
  });

  it("stores an overall band consistent with the stored criteria", async () => {
    const { submissionId } = await submitAndGradeEssay({
      userId: userA.id,
      input: { question, essay, testType: "TASK_2" },
      feedbackLocale: "uz",
    });

    const stored = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { score: true },
    });

    const { taskResponse, coherenceCohesion, lexicalResource, grammar, overall } = stored!.score!;
    expect(overall).toBeGreaterThanOrEqual(0);
    expect(overall).toBeLessThanOrEqual(9);
    // The stored overall must be reproducible from the stored criteria.
    const recomputed = (await import("@/lib/utils/scoring")).computeOverall({
      taskResponse,
      coherenceCohesion,
      lexicalResource,
      grammar,
    });
    expect(overall).toBe(recomputed);
  });
});
