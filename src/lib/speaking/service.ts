/**
 * Speaking module service.
 *
 * Full pipeline, all server-side:
 *
 *   create submission -> upload recording (private storage, DB stores only the
 *   reference) -> transcribe -> AI evaluation -> SpeakingResult -> dashboard.
 *
 * Records are never stored as binary in the database: only an AudioAsset row
 * pointing at a storage key; the bytes live on disk (dev) or object storage
 * later. Audio reads are ownership-checked by /api/audio/[id].
 *
 * The AI providers are reached exclusively through lib/ai/speaking (factory),
 * so swapping to a real model later changes nothing in this file.
 */
import { prisma } from "@/lib/db";
import {
  getSpeakingGrader,
  getTranscriptionProvider,
  speakingPipelineIsMock,
  type SpeakingGradingResult,
} from "@/lib/ai/speaking";
import { SpeakingGradingError } from "@/lib/ai/speaking/types";
import { getPrivateStorage, newStorageKey, extensionForMimeType } from "@/lib/storage";
import { countWords } from "@/lib/utils/scoring";
import type {
  PublicSpeakingTest,
  SpeakingPrompt,
  SpeakingTestSummary,
} from "@/lib/speaking/types";

export type { PublicSpeakingTest, SpeakingPrompt, SpeakingTestSummary };

/* ------------------------------------------------------------------ tests */

export async function listSpeakingTests(): Promise<SpeakingTestSummary[]> {
  const tests = await prisma.test.findMany({
    where: { module: "SPEAKING", isPublished: true },
    orderBy: { createdAt: "asc" },
    include: { sections: { include: { _count: { select: { questions: true } } } } },
  });

  return tests.map((test) => {
    const promptCount = test.sections.reduce((sum, section) => sum + section._count.questions, 0);
    return {
      id: test.id,
      title: test.title,
      description: test.description,
      partCount: test.sections.length,
      promptCount,
      // Rough guide only; the learner controls the pace of the interview.
      estimatedMinutes: Math.max(6, Math.round((promptCount * 90) / 60)),
    };
  });
}

/** Learner-facing speaking test: prompts and timers, no answers to leak. */
export async function getPublicSpeakingTest(testId: string): Promise<PublicSpeakingTest | null> {
  const test = await prisma.test.findFirst({
    where: { id: testId, module: "SPEAKING", isPublished: true },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: { questions: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!test) return null;

  const prompts: SpeakingPrompt[] = [];
  for (const section of test.sections) {
    for (const question of section.questions) {
      const meta = (question.meta as Record<string, unknown> | null) ?? {};
      prompts.push({
        id: question.id,
        number: question.number,
        part: section.order + 1,
        partTitle: section.title,
        prompt: question.prompt,
        instructions: section.instructions ?? null,
        preparationSeconds: numberOr(meta.prepSeconds, section.order === 1 ? 60 : 0),
        speakingSeconds: numberOr(meta.speakSeconds, 120),
        isCueCard: meta.isCueCard === true,
        bulletPoints: Array.isArray(meta.bulletPoints)
          ? meta.bulletPoints.filter((item): item is string => typeof item === "string")
          : [],
      });
    }
  }

  return {
    id: test.id,
    title: test.title,
    description: test.description,
    prompts: prompts.sort((a, b) => a.number - b.number),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/* ------------------------------------------------------------- submissions */

/**
 * Start a speaking submission. A Submission row is created for the chosen
 * prompt so that the attempt shows up in the dashboard history exactly like a
 * Writing submission does.
 */
export async function createSpeakingSubmission(params: {
  userId: string;
  testId: string;
  promptId?: string | null;
}): Promise<{ submissionId: string; prompt: SpeakingPrompt } | null> {
  const { userId, testId, promptId } = params;
  const test = await getPublicSpeakingTest(testId);
  if (!test || test.prompts.length === 0) return null;

  const prompt = promptId ? test.prompts.find((p) => p.id === promptId) ?? test.prompts[0] : test.prompts[0];

  const submission = await prisma.submission.create({
    data: {
      userId,
      module: "SPEAKING",
      testType: `SPEAKING_PART_${prompt.part}`,
      question: prompt.isCueCard ? `${prompt.prompt}\n${prompt.bulletPoints.join("\n")}` : prompt.prompt,
      // Filled in with the transcript once grading has run.
      essay: "",
      wordCount: 0,
      status: "PENDING",
    },
    select: { id: true },
  });

  return { submissionId: submission.id, prompt };
}

/**
 * Store an uploaded recording.
 *
 * The browser sends the recorded blob; it is written to private storage and
 * only its reference is persisted in the database.
 */
export async function attachRecording(params: {
  userId: string;
  submissionId: string;
  data: Uint8Array;
  mimeType: string;
  durationSeconds?: number | null;
}): Promise<{ assetId: string; sizeBytes: number; mimeType: string } | null> {
  const { userId, submissionId, data, mimeType, durationSeconds } = params;

  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, userId, module: "SPEAKING" },
    select: { id: true },
  });
  if (!submission) return null;

  const extension = extensionForMimeType(mimeType);
  const key = newStorageKey(`speaking/${userId}`, extension);
  const stored = await getPrivateStorage().save({ key, data, mimeType });

  const asset = await prisma.audioAsset.create({
    data: {
      kind: "SPEAKING_RECORDING",
      storageKey: stored.key,
      url: stored.url,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      durationSeconds: durationSeconds ?? null,
      userId,
      submissionId,
    },
    select: { id: true, sizeBytes: true, mimeType: true },
  });

  return {
    assetId: asset.id,
    sizeBytes: asset.sizeBytes ?? stored.sizeBytes,
    mimeType: asset.mimeType,
  };
}

export interface SpeakingPipelineResult {
  submissionId: string;
  status: "COMPLETED" | "FAILED";
  isMock: boolean;
  transcript: string;
  overall: number;
  reason?: string;
}

/**
 * Run the evaluation pipeline for a submitted recording.
 *
 * 1. load the newest recording of the submission (owner-scoped);
 * 2. transcribe it with the configured provider;
 * 3. grade the transcript with the configured provider;
 * 4. persist the structured result — the overall band is recomputed on the
 *    server from the criterion scores.
 *
 * Failures never throw to the caller: the submission is marked FAILED and a
 * secret-free reason is returned, so the API can answer with a safe error.
 */
export async function evaluateSpeakingSubmission(params: {
  userId: string;
  submissionId: string;
  feedbackLocale?: string;
  onRetry?: (info: { attempt: number; reason: string }) => void;
}): Promise<SpeakingPipelineResult | null> {
  const { userId, submissionId, feedbackLocale } = params;

  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, userId, module: "SPEAKING" },
    include: { recordings: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!submission) return null;

  const recording = submission.recordings[0];
  if (!recording) {
    await prisma.submission.update({ where: { id: submissionId }, data: { status: "FAILED" } });
    return {
      submissionId,
      status: "FAILED",
      isMock: false,
      transcript: "",
      overall: 0,
      reason: "no_recording",
    };
  }

  const file = await getPrivateStorage().read(recording.storageKey);
  if (!file) {
    await prisma.submission.update({ where: { id: submissionId }, data: { status: "FAILED" } });
    return {
      submissionId,
      status: "FAILED",
      isMock: false,
      transcript: "",
      overall: 0,
      reason: "recording_missing",
    };
  }

  // Draft row so a failed attempt is visible (and replaceable on retry).
  await prisma.submission.update({ where: { id: submissionId }, data: { status: "PENDING" } });

  let transcript = "";
  let isMock = false;

  try {
    // Providers are resolved inside the try on purpose: a misconfigured
    // provider (AI_MODE=gemini without GEMINI_API_KEY) must fail like any
    // other pipeline error and mark the submission FAILED, never leave it
    // PENDING or crash the route.
    const transcriber = getTranscriptionProvider();
    const grader = getSpeakingGrader();
    isMock = speakingPipelineIsMock();

    const transcription = await transcriber.transcribe({
      audio: file.data,
      mimeType: recording.mimeType,
      language: "en",
    });
    transcript = transcription.transcript;

    if (transcription.empty || transcript.trim().length === 0) {
      await prisma.submission.update({ where: { id: submissionId }, data: { status: "FAILED" } });
      return {
        submissionId,
        status: "FAILED",
        isMock,
        transcript: "",
        overall: 0,
        reason: "empty_transcript",
      };
    }

    const grading: SpeakingGradingResult = await grader.gradeSpeaking({
      transcript,
      question: submission.question,
      part: Number(submission.testType.replace("SPEAKING_PART_", "")) || null,
      feedbackLocale,
    });

    await persistSpeakingResult({ submissionId, transcript, grading, transcriber, isMock });

    return {
      submissionId,
      status: "COMPLETED",
      isMock,
      transcript,
      overall: grading.overallBand,
    };
  } catch (error) {
    await prisma.submission.update({ where: { id: submissionId }, data: { status: "FAILED" } });

    const reason =
      error instanceof SpeakingGradingError
        ? `${error.details.validationStatus}: ${error.details.reason}`
        : error instanceof Error
          ? error.message
          : "unknown_error";

    // Server-side log only; the API response stays generic.
    console.error(`[speaking] evaluation failed for submission ${submissionId}: ${reason}`);

    return {
      submissionId,
      status: "FAILED",
      isMock,
      transcript,
      overall: 0,
      reason,
    };
  }
}

async function persistSpeakingResult(params: {
  submissionId: string;
  transcript: string;
  grading: SpeakingGradingResult;
  transcriber: { name: string; model: string; isMock: boolean };
  isMock: boolean;
}): Promise<void> {
  const { submissionId, transcript, grading, transcriber, isMock } = params;
  const { evaluation, overallBand, meta } = grading;

  const payload = {
    transcript,
    transcriptionProvider: transcriber.name,
    transcriptionModel: transcriber.model,
    fluencyCoherence: evaluation.scores.fluencyCoherence.band,
    lexicalResource: evaluation.scores.lexicalResource.band,
    grammar: evaluation.scores.grammaticalRange.band,
    pronunciation: evaluation.scores.pronunciation.band,
    overall: overallBand,
    summary: evaluation.summary,
    strengths: evaluation.strengths,
    weaknesses: evaluation.weaknesses,
    improvements: evaluation.improvements,
    aiProvider: meta.provider,
    aiModel: meta.model,
    promptVersion: meta.promptVersion,
    isMock,
    rawResponse: meta.rawResponse ?? null,
  };

  await prisma.$transaction([
    prisma.speakingResult.upsert({
      where: { submissionId },
      update: payload,
      create: { submissionId, ...payload },
    }),
    prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: "COMPLETED",
        // The transcript is the "text" of a speaking attempt; keeping it here
        // makes the submission list and the dashboard uniform across modules.
        essay: transcript,
        wordCount: countWords(transcript),
      },
    }),
  ]);
}

/* ---------------------------------------------------------------- reading */

/** Owner-scoped speaking submission with its result and recordings. */
export async function getOwnSpeakingSubmission(userId: string, submissionId: string) {
  return prisma.submission.findFirst({
    where: { id: submissionId, userId, module: "SPEAKING" },
    include: {
      speakingResult: true,
      recordings: { orderBy: { createdAt: "desc" } },
    },
  });
}

export interface SpeakingProgress {
  attempts: number;
  latestBand: number | null;
  previousBand: number | null;
  bestBand: number | null;
  averageBand: number | null;
  improvement: number | null;
  isMock: boolean;
  history: Array<{
    submissionId: string;
    question: string;
    overall: number;
    status: string;
    isMock: boolean;
    date: string;
  }>;
}

/** Dashboard-facing progress for the Speaking module (database only). */
export async function getSpeakingProgress(userId: string): Promise<SpeakingProgress> {
  const submissions = await prisma.submission.findMany({
    where: { userId, module: "SPEAKING" },
    orderBy: { createdAt: "asc" },
    include: { speakingResult: { select: { overall: true, isMock: true } } },
  });

  const graded = submissions.filter((s) => s.speakingResult);
  const bands = graded.map((s) => s.speakingResult!.overall);
  const latest = bands.length ? bands[bands.length - 1] : null;
  const previous = bands.length > 1 ? bands[bands.length - 2] : null;

  return {
    attempts: submissions.length,
    latestBand: latest,
    previousBand: previous,
    bestBand: bands.length ? Math.max(...bands) : null,
    averageBand: bands.length
      ? Math.round((bands.reduce((a, b) => a + b, 0) / bands.length) * 10) / 10
      : null,
    improvement: latest != null && previous != null ? Math.round((latest - previous) * 10) / 10 : null,
    isMock: graded.length > 0 && graded.every((s) => s.speakingResult!.isMock),
    history: submissions.map((s) => ({
      submissionId: s.id,
      question: s.question,
      overall: s.speakingResult?.overall ?? 0,
      status: s.status,
      isMock: s.speakingResult?.isMock ?? false,
      date: s.createdAt.toISOString(),
    })),
  };
}
