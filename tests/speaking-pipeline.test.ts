/**
 * Speaking pipeline tests: audio storage, mock transcription, mock evaluation,
 * persistence, ownership and failure handling. No external API is contacted —
 * the providers are injected through the lib/ai/speaking factory.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { MemoryStorage, resetStorage, setStorageForTesting } from "@/lib/storage";
import { setSpeakingProvidersForTesting } from "@/lib/ai/speaking";
import { MockSpeakingGrader, MockTranscriptionProvider } from "@/lib/ai/speaking/mock";
import { SpeakingGradingError } from "@/lib/ai/speaking/types";
import type {
  SpeakingGradingInput,
  SpeakingGradingResult,
  SpeakingGrader,
  TranscriptionProvider,
} from "@/lib/ai/speaking/types";
import {
  attachRecording,
  createSpeakingSubmission,
  evaluateSpeakingSubmission,
  getOwnSpeakingSubmission,
  getPublicSpeakingTest,
  getSpeakingProgress,
  listSpeakingTests,
} from "@/lib/speaking/service";

process.env.DATABASE_URL ??= "postgresql://axi:axi@localhost:5432/axi";

let userA: { id: string };
let userB: { id: string };
let testId: string;
let promptId: string;

/** Small fake audio payload — never a real speech file. */
const FAKE_AUDIO = Buffer.from(new Uint8Array(2048).fill(7));

beforeAll(async () => {
  const suffix = Date.now();
  userA = await prisma.user.create({
    data: { phone: `+99893${suffix % 10000000}`, name: "Speaker A", passwordHash: "x" },
  });
  userB = await prisma.user.create({
    data: { phone: `+99894${suffix % 10000000}`, name: "Speaker B", passwordHash: "x" },
  });

  const test = await prisma.test.create({
    data: {
      module: "SPEAKING",
      title: `Speaking fixture ${suffix}`,
      isPublished: true,
      durationMinutes: 15,
      sections: {
        create: [
          {
            order: 0,
            title: "Part 1 — Introduction",
            instructions: "Answer the questions.",
            questions: {
              create: [
                {
                  number: 1,
                  order: 0,
                  type: "SHORT_ANSWER",
                  prompt: "Do you live in a house or an apartment?",
                  answer: { answers: [] },
                  meta: { prepSeconds: 3, speakSeconds: 45 },
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

  testId = test.id;
  promptId = test.sections[0].questions[0].id;
});

afterEach(() => {
  setSpeakingProvidersForTesting({});
  resetStorage();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await prisma.test.deleteMany({ where: { id: testId } });
  setSpeakingProvidersForTesting({});
  resetStorage();
  await prisma.$disconnect();
});

describe("speaking catalog", () => {
  it("lists the speaking test and exposes prompts with timers", async () => {
    const tests = await listSpeakingTests();
    expect(tests.some((t) => t.id === testId)).toBe(true);

    const test = await getPublicSpeakingTest(testId);
    expect(test!.prompts).toHaveLength(1);
    expect(test!.prompts[0].preparationSeconds).toBe(3);
    expect(test!.prompts[0].speakingSeconds).toBe(45);
    expect(test!.prompts[0].part).toBe(1);
  });

  it("rejects a prompt id that does not belong to the test", async () => {
    const created = await createSpeakingSubmission({
      userId: userA.id,
      testId,
      promptId: "missing-prompt",
    });
    expect(created).toBeNull();
  });
});

describe("recording storage", () => {
  it("stores the upload as a private asset and keeps no binary in the database", async () => {
    const storage = new MemoryStorage("memory-test", "private", "/api/audio");
    setStorageForTesting({ private: storage });

    const created = await createSpeakingSubmission({ userId: userA.id, testId, promptId });
    expect(created).not.toBeNull();

    const audio = await attachRecording({
      userId: userA.id,
      submissionId: created!.submissionId,
      data: FAKE_AUDIO,
      mimeType: "audio/webm",
      durationSeconds: 12,
    });

    expect(audio).not.toBeNull();
    expect(audio!.sizeBytes).toBe(FAKE_AUDIO.byteLength);

    const asset = await prisma.audioAsset.findUnique({ where: { id: audio!.assetId } });
    expect(asset!.kind).toBe("SPEAKING_RECORDING");
    expect(asset!.userId).toBe(userA.id);
    expect(asset!.storageKey.startsWith("speaking/")).toBe(true);
    // Bytes live in storage, not in the row.
    expect(JSON.stringify(asset)).not.toContain(FAKE_AUDIO.toString("base64").slice(0, 40));
  });

  it("refuses to attach a recording to another user's submission", async () => {
    const created = await createSpeakingSubmission({ userId: userA.id, testId, promptId });
    const denied = await attachRecording({
      userId: userB.id,
      submissionId: created!.submissionId,
      data: FAKE_AUDIO,
      mimeType: "audio/webm",
    });
    expect(denied).toBeNull();
  });

  it("refuses duplicate recordings for one submission", async () => {
    setStorageForTesting({ private: new MemoryStorage() });
    const created = await createSpeakingSubmission({ userId: userA.id, testId, promptId });
    await attachRecording({
      userId: userA.id,
      submissionId: created!.submissionId,
      data: FAKE_AUDIO,
      mimeType: "audio/webm",
    });
    await expect(
      attachRecording({
        userId: userA.id,
        submissionId: created!.submissionId,
        data: FAKE_AUDIO,
        mimeType: "audio/webm",
      })
    ).rejects.toMatchObject({ code: "recording_already_uploaded" });
  });
});

describe("evaluation pipeline (mock providers)", () => {
  it("transcribes, evaluates, stores the result and marks it as MOCK", async () => {
    setStorageForTesting({ private: new MemoryStorage() });
    const transcriber = new MockTranscriptionProvider();
    const grader = new MockSpeakingGrader();
    const transcribeSpy = vi.spyOn(transcriber, "transcribe");
    const gradeSpy = vi.spyOn(grader, "gradeSpeaking");
    setSpeakingProvidersForTesting({
      transcriber,
      grader,
    });

    const created = await createSpeakingSubmission({ userId: userA.id, testId, promptId });
    await attachRecording({
      userId: userA.id,
      submissionId: created!.submissionId,
      data: FAKE_AUDIO,
      mimeType: "audio/webm",
      durationSeconds: 20,
    });

    const result = await evaluateSpeakingSubmission({
      userId: userA.id,
      submissionId: created!.submissionId,
      feedbackLocale: "uz",
    });

    expect(result!.status).toBe("COMPLETED");
    expect(result!.isMock).toBe(true);
    expect(result!.transcript).toContain("MOCK TRANSCRIPT");
    expect(result!.overall).toBeGreaterThan(0);

    const stored = await getOwnSpeakingSubmission(userA.id, created!.submissionId);
    expect(stored!.status).toBe("COMPLETED");
    expect(stored!.speakingResult!.isMock).toBe(true);
    expect(stored!.speakingResult!.transcriptionProvider).toBe("mock");
    expect(stored!.speakingResult!.aiProvider).toBe("mock");
    expect(stored!.speakingResult!.overall).toBe(result!.overall);
    // The transcript becomes the submission text so the dashboard is uniform.
    expect(stored!.essay).toBe(result!.transcript);
    expect(stored!.wordCount).toBeGreaterThan(0);
    expect(stored!.recordings).toHaveLength(1);

    const retry = await evaluateSpeakingSubmission({
      userId: userA.id,
      submissionId: created!.submissionId,
      feedbackLocale: "uz",
    });
    expect(retry).toMatchObject({ status: "COMPLETED", overall: result!.overall, isMock: true });
    expect(transcribeSpy).toHaveBeenCalledOnce();
    expect(gradeSpy).toHaveBeenCalledOnce();
  });

  it("marks the submission FAILED when no recording was uploaded", async () => {
    setSpeakingProvidersForTesting({
      transcriber: new MockTranscriptionProvider(),
      grader: new MockSpeakingGrader(),
    });

    const created = await createSpeakingSubmission({ userId: userA.id, testId, promptId });
    const result = await evaluateSpeakingSubmission({
      userId: userA.id,
      submissionId: created!.submissionId,
    });

    expect(result!.status).toBe("FAILED");
    expect(result!.reason).toBe("no_recording");

    const stored = await getOwnSpeakingSubmission(userA.id, created!.submissionId);
    expect(stored!.status).toBe("FAILED");
    expect(stored!.speakingResult).toBeNull();
  });

  it("fails safely (no crash, no raw provider text) when the grader errors", async () => {
    setStorageForTesting({ private: new MemoryStorage() });

    const failingGrader: SpeakingGrader = {
      provider: "test",
      model: "broken",
      promptVersion: "TEST_V1",
      isMock: false,
      async gradeSpeaking(_input: SpeakingGradingInput): Promise<SpeakingGradingResult> {
        throw new SpeakingGradingError({
          provider: "test",
          model: "broken",
          promptVersion: "TEST_V1",
          isMock: false,
          latencyMs: 5,
          attempts: 2,
          retryCount: 1,
          validationStatus: "PROVIDER_ERROR",
          validationErrors: [],
          rawResponse: null,
          reason: "provider responded 500",
        });
      },
    };

    setSpeakingProvidersForTesting({
      transcriber: new MockTranscriptionProvider(),
      grader: failingGrader,
    });

    const created = await createSpeakingSubmission({ userId: userA.id, testId, promptId });
    await attachRecording({
      userId: userA.id,
      submissionId: created!.submissionId,
      data: FAKE_AUDIO,
      mimeType: "audio/webm",
    });

    const result = await evaluateSpeakingSubmission({
      userId: userA.id,
      submissionId: created!.submissionId,
    });

    expect(result!.status).toBe("FAILED");
    expect(result!.reason).toContain("PROVIDER_ERROR");
    expect(result!.overall).toBe(0);

    const stored = await getOwnSpeakingSubmission(userA.id, created!.submissionId);
    expect(stored!.speakingResult).toBeNull();
  });

  it("returns FAILED when the transcription is empty", async () => {
    setStorageForTesting({ private: new MemoryStorage() });

    const emptyTranscriber: TranscriptionProvider = {
      name: "test",
      model: "silence",
      isMock: false,
      async transcribe() {
        return {
          transcript: "",
          provider: "test",
          model: "silence",
          isMock: false,
          latencyMs: 1,
          empty: true,
        };
      },
    };

    setSpeakingProvidersForTesting({
      transcriber: emptyTranscriber,
      grader: new MockSpeakingGrader(),
    });

    const created = await createSpeakingSubmission({ userId: userA.id, testId, promptId });
    await attachRecording({
      userId: userA.id,
      submissionId: created!.submissionId,
      data: FAKE_AUDIO,
      mimeType: "audio/webm",
    });

    const result = await evaluateSpeakingSubmission({
      userId: userA.id,
      submissionId: created!.submissionId,
    });
    expect(result!.status).toBe("FAILED");
    expect(result!.reason).toBe("empty_transcript");
  });

  it("closes an abandoned PENDING submission instead of leaving it forever", async () => {
    const created = await createSpeakingSubmission({ userId: userA.id, testId, promptId });
    await prisma.submission.update({
      where: { id: created!.submissionId },
      data: { createdAt: new Date(Date.now() - 31 * 60_000) },
    });

    const stored = await getOwnSpeakingSubmission(userA.id, created!.submissionId);
    expect(stored!.status).toBe("FAILED");
  });
});

describe("ownership and progress", () => {
  it("hides another user's speaking submission and result", async () => {
    setStorageForTesting({ private: new MemoryStorage() });
    setSpeakingProvidersForTesting({
      transcriber: new MockTranscriptionProvider(),
      grader: new MockSpeakingGrader(),
    });

    const created = await createSpeakingSubmission({ userId: userA.id, testId, promptId });
    await attachRecording({
      userId: userA.id,
      submissionId: created!.submissionId,
      data: FAKE_AUDIO,
      mimeType: "audio/webm",
    });
    await evaluateSpeakingSubmission({ userId: userA.id, submissionId: created!.submissionId });

    expect(await getOwnSpeakingSubmission(userB.id, created!.submissionId)).toBeNull();
    expect(await getOwnSpeakingSubmission(userA.id, created!.submissionId)).not.toBeNull();
  });

  it("reports progress and the mock flag from the database", async () => {
    const progress = await getSpeakingProgress(userA.id);
    expect(progress.attempts).toBeGreaterThan(0);
    expect(progress.latestBand).not.toBeNull();
    expect(progress.isMock).toBe(true);
    for (const item of progress.history) {
      expect(item.status).toBeDefined();
      // Only graded attempts can carry a provider flag.
      if (item.status === "COMPLETED") expect(item.isMock).toBe(true);
      else expect(item.isMock).toBe(false);
    }
  });
});
