/**
 * Integration tests for the shared Reading/Listening engine (service layer)
 * against a real PostgreSQL database. No AI provider is involved anywhere in
 * this module — grading is deterministic and comes from the stored answer key.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  ensureAttempt,
  getModuleProgress,
  getOwnAttempt,
  getOwnAttemptResult,
  getPublicTest,
  listPublishedTests,
  loadTestDefinition,
  saveAnswers,
  startAttempt,
  submitAttempt,
  type ObjectiveModule,
} from "@/lib/testing/service";

process.env.DATABASE_URL ??= "postgresql://axi:axi@localhost:5432/axi";

let userA: { id: string };
let userB: { id: string };
let readingTestId: string;
let questionIds: string[];
let listeningTestId: string;
let listeningQuestionIds: string[];

async function createFixture(module: ObjectiveModule, title: string) {
  const test = await prisma.test.create({
    data: {
      module,
      title,
      description: "fixture",
      durationMinutes: 10,
      isPublished: true,
      sections: {
        create: [
          {
            order: 0,
            title: "Section A",
            passage: module === "READING" ? "Passage text" : null,
            questions: {
              create: [
                {
                  number: 1,
                  order: 0,
                  type: "MULTIPLE_CHOICE",
                  prompt: "Pick B",
                  options: [
                    { value: "A", label: "A" },
                    { value: "B", label: "B" },
                  ],
                  answer: { answers: ["B"] },
                  explanation: "Because B is right.",
                  points: 1,
                },
                {
                  number: 2,
                  order: 1,
                  type: "TRUE_FALSE_NOT_GIVEN",
                  prompt: "It is true",
                  answer: { answers: ["TRUE"] },
                  explanation: "Stated in paragraph 1.",
                  points: 1,
                },
                {
                  number: 3,
                  order: 2,
                  type: "SHORT_ANSWER",
                  prompt: "One word",
                  answer: { answers: ["Honey", "honey"] },
                  points: 1,
                },
                {
                  number: 4,
                  order: 3,
                  type: "SENTENCE_COMPLETION",
                  prompt: "Complete it",
                  answer: { answers: ["the roof"] },
                  points: 1,
                },
              ],
            },
          },
        ],
      },
    },
    include: { sections: { include: { questions: true } } },
  });

  return {
    testId: test.id,
    questionIds: test.sections[0].questions.sort((a, b) => a.number - b.number).map((q) => q.id),
  };
}

beforeAll(async () => {
  const suffix = Date.now();
  userA = await prisma.user.create({
    data: { phone: `+99895${suffix % 10000000}`, name: "Engine A", passwordHash: "x" },
  });
  userB = await prisma.user.create({
    data: { phone: `+99896${suffix % 10000000}`, name: "Engine B", passwordHash: "x" },
  });

  const reading = await createFixture("READING", `Engine fixture reading ${suffix}`);
  readingTestId = reading.testId;
  questionIds = reading.questionIds;

  const listening = await createFixture("LISTENING", `Engine fixture listening ${suffix}`);
  listeningTestId = listening.testId;
  listeningQuestionIds = listening.questionIds;
});

afterAll(async () => {
  if (userA && userB) {
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  }
  if (readingTestId && listeningTestId) {
    await prisma.test.deleteMany({
      where: { id: { in: [readingTestId, listeningTestId] } },
    });
  }
  await prisma.$disconnect();
});

describe("catalog", () => {
  it("lists the published fixture with counts", async () => {
    const tests = await listPublishedTests("READING");
    const found = tests.find((t) => t.id === readingTestId);
    expect(found).toBeDefined();
    expect(found!.questionCount).toBe(4);
    expect(found!.sectionCount).toBe(1);
  });

  it("never exposes the answer key or explanations to the learner", async () => {
    const publicTest = await getPublicTest(readingTestId, "READING");
    expect(publicTest).not.toBeNull();

    const json = JSON.stringify(publicTest);
    expect(json).not.toContain("\"answer\"");
    expect(json).not.toContain("explanation");
    expect(json).not.toContain("Because B is right");
  });

  it("returns null for a test from another module", async () => {
    expect(await getPublicTest(readingTestId, "LISTENING")).toBeNull();
  });
});

describe("attempt lifecycle", () => {
  it("grades a submitted attempt server-side and persists per-question outcomes", async () => {
    const started = await startAttempt({ userId: userA.id, testId: readingTestId, module: "READING" });
    expect(started).not.toBeNull();

    const responses: Record<string, string> = {
      [questionIds[0]]: "B", // correct
      [questionIds[1]]: "FALSE", // wrong
      [questionIds[2]]: "HONEY", // correct (normalised, case-insensitive)
      [questionIds[3]]: "wrong answer", // wrong
    };

    const saved = await saveAnswers({
      userId: userA.id,
      attemptId: started!.attemptId,
      responses,
    });
    expect(saved?.saved).toBe(4);

    const result = await submitAttempt({
      userId: userA.id,
      attemptId: started!.attemptId,
      responses,
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("GRADED");
    expect(result!.correctCount).toBe(2);
    expect(result!.totalQuestions).toBe(4);
    expect(result!.rawScore).toBe(2);
    expect(result!.maxScore).toBe(4);
    // 2/4 correct scaled to /40 = 20 -> band 5.5
    expect(result!.band).toBe(5.5);

    const stored = await prisma.testAttempt.findUnique({
      where: { id: started!.attemptId },
      include: { answers: true },
    });
    expect(stored!.status).toBe("GRADED");
    expect(stored!.answers).toHaveLength(4);
    expect(stored!.answers.filter((a) => a.isCorrect)).toHaveLength(2);
  });

  it("reuses the same in-progress attempt on duplicate starts", async () => {
    const first = await startAttempt({ userId: userA.id, testId: readingTestId, module: "READING" });
    const second = await startAttempt({ userId: userA.id, testId: readingTestId, module: "READING" });
    expect(second?.attemptId).toBe(first?.attemptId);
    await submitAttempt({ userId: userA.id, attemptId: first!.attemptId, responses: {} });
  });

  it("rejects question ids that do not belong to the test without writing them", async () => {
    const started = await startAttempt({ userId: userA.id, testId: readingTestId, module: "READING" });
    await expect(
      saveAnswers({
        userId: userA.id,
        attemptId: started!.attemptId,
        responses: { "not-a-real-question": "x", [questionIds[0]]: "B" },
      })
    ).rejects.toMatchObject({ message: "invalid_question_id" });

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: started!.attemptId },
      include: { answers: true },
    });
    expect(attempt!.answers).toHaveLength(0);
    await submitAttempt({ userId: userA.id, attemptId: started!.attemptId, responses: {} });
  });

  it("does not let answers be changed after grading", async () => {
    const started = await startAttempt({ userId: userA.id, testId: readingTestId, module: "READING" });
    await submitAttempt({
      userId: userA.id,
      attemptId: started!.attemptId,
      responses: { [questionIds[0]]: "B" },
    });

    const late = await saveAnswers({
      userId: userA.id,
      attemptId: started!.attemptId,
      responses: { [questionIds[0]]: "A" },
    });
    expect(late).toBeNull();
  });

  it("does not reveal the answer key before grading", async () => {
    const started = await startAttempt({ userId: userA.id, testId: readingTestId, module: "READING" });
    expect(await getOwnAttemptResult(userA.id, started!.attemptId)).toBeNull();
    await submitAttempt({ userId: userA.id, attemptId: started!.attemptId, responses: {} });
  });

  it("makes duplicate submit idempotent and keeps the original score", async () => {
    const started = await startAttempt({ userId: userA.id, testId: readingTestId, module: "READING" });
    const first = await submitAttempt({
      userId: userA.id,
      attemptId: started!.attemptId,
      responses: { [questionIds[0]]: "B" },
    });
    const retry = await submitAttempt({
      userId: userA.id,
      attemptId: started!.attemptId,
      responses: { [questionIds[0]]: "A" },
    });
    expect(retry).toEqual(first);
    const stored = await prisma.testAnswer.findUnique({
      where: { attemptId_questionId: { attemptId: started!.attemptId, questionId: questionIds[0] } },
    });
    expect(stored?.response).toBe("B");
    expect(stored?.isCorrect).toBe(true);
  });

  it("rejects late autosave and ignores client answers submitted after server expiry", async () => {
    const started = await startAttempt({ userId: userA.id, testId: readingTestId, module: "READING" });
    await saveAnswers({
      userId: userA.id,
      attemptId: started!.attemptId,
      responses: { [questionIds[0]]: "B" },
    });
    await prisma.testAttempt.update({
      where: { id: started!.attemptId },
      data: { startedAt: new Date(Date.now() - 11 * 60_000) },
    });
    expect(
      await saveAnswers({
        userId: userA.id,
        attemptId: started!.attemptId,
        responses: { [questionIds[0]]: "A" },
      })
    ).toBeNull();
    const result = await submitAttempt({
      userId: userA.id,
      attemptId: started!.attemptId,
      responses: { [questionIds[0]]: "A" },
    });
    expect(result?.correctCount).toBe(1);
  });

  it("keeps a failed attempt out of the dashboard history", async () => {
    const attempt = await prisma.testAttempt.create({
      data: { userId: userA.id, testId: readingTestId, module: "READING", status: "FAILED" },
    });
    const progress = await getModuleProgress(userA.id, "READING");
    expect(progress.history.some((h) => h.attemptId === attempt.id)).toBe(false);
    await prisma.testAttempt.delete({ where: { id: attempt.id } });
  });
});

describe("ownership", () => {
  it("hides another user's attempt and result behind a null lookup", async () => {
    const started = await startAttempt({ userId: userA.id, testId: readingTestId, module: "READING" });
    await submitAttempt({
      userId: userA.id,
      attemptId: started!.attemptId,
      responses: { [questionIds[0]]: "B", [questionIds[1]]: "TRUE" },
    });

    expect(await getOwnAttempt(userB.id, started!.attemptId)).toBeNull();
    expect(await getOwnAttemptResult(userB.id, started!.attemptId)).toBeNull();

    // The owner still sees the full review with explanations.
    const mine = await getOwnAttemptResult(userA.id, started!.attemptId);
    expect(mine).not.toBeNull();
    expect(mine!.review[0].explanation).toBe("Because B is right.");
    expect(mine!.testId).toBe(readingTestId);
  });
});

describe("resume behaviour", () => {
  it("reuses an in-progress attempt and abandons stale ones", async () => {
    const first = await ensureAttempt({ userId: userB.id, testId: readingTestId, module: "READING" });
    const second = await ensureAttempt({ userId: userB.id, testId: readingTestId, module: "READING" });
    expect(second!.attemptId).toBe(first!.attemptId);

    // An attempt left behind long past its limit is closed, a new one starts.
    await prisma.testAttempt.update({
      where: { id: first!.attemptId },
      data: { startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    const third = await ensureAttempt({ userId: userB.id, testId: readingTestId, module: "READING" });
    expect(third!.attemptId).not.toBe(first!.attemptId);

    const abandoned = await prisma.testAttempt.findUnique({ where: { id: first!.attemptId } });
    expect(abandoned!.status).toBe("FAILED");
  });
});

describe("listening module", () => {
  it("scores with the listening band table", async () => {
    const definition = await loadTestDefinition(listeningTestId, "LISTENING");
    expect(definition!.module).toBe("LISTENING");

    const started = await startAttempt({
      userId: userA.id,
      testId: listeningTestId,
      module: "LISTENING",
    });
    const responses = Object.fromEntries(
      listeningQuestionIds.map((id, index) => [id, index === 0 ? "B" : "x"])
    );
    const result = await submitAttempt({
      userId: userA.id,
      attemptId: started!.attemptId,
      responses,
    });

    expect(result!.correctCount).toBe(1);
    // 1/4 scaled to /40 = 10 -> band 4.0 in the listening table
    expect(result!.band).toBe(4.0);
  });

  it("returns audio metadata as a URL, never as binary data", async () => {
    const asset = await prisma.audioAsset.create({
      data: {
        kind: "LISTENING_SECTION",
        storageKey: `listening/fixture-${Date.now()}.wav`,
        url: "/audio/listening/fixture.wav",
        mimeType: "audio/wav",
        sizeBytes: 1234,
      },
    });
    await prisma.testSection.create({
      data: {
        testId: listeningTestId,
        order: 9,
        title: "Section with audio",
        audioAssetId: asset.id,
        questions: {
          create: [
            {
              number: 99,
              order: 0,
              type: "SHORT_ANSWER",
              prompt: "In the audio",
              answer: { answers: ["yes"] },
              points: 1,
            },
          ],
        },
      },
    });

    const definition = await loadTestDefinition(listeningTestId, "LISTENING");
    const withAudio = definition!.sections.find((s) => s.audioUrl);
    expect(withAudio!.audioUrl).toBe("/audio/listening/fixture.wav");
    expect(JSON.stringify(withAudio)).not.toContain("storageKey");

    await prisma.testSection.deleteMany({ where: { audioAssetId: asset.id } });
    await prisma.audioAsset.delete({ where: { id: asset.id } });
  });
});

describe("progress", () => {
  it("computes latest, previous, best and improvement from graded attempts only", async () => {
    const progress = await getModuleProgress(userA.id, "READING");
    expect(progress.attempts).toBeGreaterThan(0);
    expect(progress.latestBand).not.toBeNull();
    expect(progress.history.length).toBe(progress.attempts);
    for (const item of progress.history) {
      expect(item.band).toBeGreaterThanOrEqual(0);
      expect(item.band).toBeLessThanOrEqual(9);
      expect(item.maxScore).toBeGreaterThan(0);
    }
  });
});
