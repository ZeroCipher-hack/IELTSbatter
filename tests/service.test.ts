/**
 * Integration tests for the writing service against a real PostgreSQL
 * database (uses DATABASE_URL). The AI provider is mocked/injected so no
 * external API is ever called.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { setGraderForTesting } from "@/lib/ai/grading";
import { MockGrader } from "@/lib/ai/mock";
import type { AIGrader } from "@/lib/ai/schema";
import { submitAndGradeEssay, getOwnSubmission } from "@/lib/writing/service";

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

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  setGraderForTesting(undefined);
  await prisma.$disconnect();
});

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

  it("marks the submission FAILED when the AI provider returns invalid data", async () => {
    const failing: AIGrader = {
      provider: "failing",
      model: "failing-1",
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
});
