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
import { sanitizeAiText } from "@/lib/ai/sanitize";
import { getPrivateStorage, newStorageKey, extensionForMimeType } from "@/lib/storage";
import { countWords } from "@/lib/utils/scoring";
import type {
  PublicSpeakingTest,
  SpeakingPrompt,
  SpeakingInterviewSnapshot,
  SpeakingTestSummary,
} from "@/lib/speaking/types";
import { decideBeginPart, timerRemaining } from "@/lib/speaking/state-machine";

export type { PublicSpeakingTest, SpeakingPrompt, SpeakingTestSummary };

export class SpeakingSubmissionStateError extends Error {
  constructor(readonly code: "recording_already_uploaded" | "submission_not_editable" | "evaluation_in_progress" | "invalid_transition" | "timer_not_elapsed" | "interview_expired") {
    super(code);
    this.name = "SpeakingSubmissionStateError";
  }
}

const TERMINAL_INTERVIEW_STATES = ["COMPLETED", "FAILED"] as const;
const TIMER_GRACE_SECONDS = 30;

export type { SpeakingInterviewSnapshot } from "@/lib/speaking/types";

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

function promptForPart(test: PublicSpeakingTest, part: number): SpeakingPrompt | undefined {
  return test.prompts.find((prompt) => prompt.part === part);
}

function timerFor(state: SpeakingInterviewSnapshot["state"], prompt: SpeakingPrompt): number {
  return state === "PREPARING" ? prompt.preparationSeconds : prompt.speakingSeconds;
}

async function snapshotInterview(interview: {
  id: string; submissionId: string; testId: string; state: SpeakingInterviewSnapshot["state"];
  currentPart: number; currentPromptId: string; stateStartedAt: Date; failureReason: string | null;
}, test: PublicSpeakingTest, now = new Date()): Promise<SpeakingInterviewSnapshot> {
  const prompt = test.prompts.find((item) => item.id === interview.currentPromptId) ?? promptForPart(test, interview.currentPart);
  const total = prompt && (interview.state === "PREPARING" || interview.state.startsWith("PART_"))
    ? timerFor(interview.state, prompt)
    : 0;
  return {
    ...interview,
    stateStartedAt: interview.stateStartedAt.toISOString(),
    serverNow: now.toISOString(),
    remainingSeconds: timerRemaining(interview.stateStartedAt, total, now),
  };
}

/** Create one interview, or recover the caller's existing non-terminal one. */
export async function createOrResumeSpeakingInterview(params: {
  userId: string; testId: string;
}): Promise<SpeakingInterviewSnapshot | null> {
  const test = await getPublicSpeakingTest(params.testId);
  const firstPrompt = test && promptForPart(test, 1);
  if (!test || !firstPrompt) return null;

  let interview = await prisma.speakingInterview.findFirst({
    where: { userId: params.userId, testId: params.testId, state: { notIn: [...TERMINAL_INTERVIEW_STATES] } },
    orderBy: { createdAt: "desc" },
  });
  if (!interview) {
    try {
      interview = await prisma.$transaction(async (tx) => {
        const submission = await tx.submission.create({
          data: {
            userId: params.userId,
            module: "SPEAKING",
            testType: "SPEAKING_INTERVIEW",
            question: test.prompts.map((prompt) => prompt.prompt).join("\n"),
            essay: "",
            wordCount: 0,
            status: "PENDING",
          },
        });
        return tx.speakingInterview.create({
          data: {
            userId: params.userId,
            testId: params.testId,
            submissionId: submission.id,
            currentPromptId: firstPrompt.id,
          },
        });
      });
    } catch (error) {
      // The partial unique index resolves simultaneous browser reconnects.
      interview = await prisma.speakingInterview.findFirst({
        where: { userId: params.userId, testId: params.testId, state: { notIn: [...TERMINAL_INTERVIEW_STATES] } },
        orderBy: { createdAt: "desc" },
      });
      if (!interview) throw error;
    }
  }
  return recoverSpeakingInterview(params.userId, interview.id, test);
}

/** Owner-scoped recovery; all timer calculations use persisted server time. */
export async function recoverSpeakingInterview(
  userId: string,
  interviewId: string,
  knownTest?: PublicSpeakingTest
): Promise<SpeakingInterviewSnapshot | null> {
  let interview = await prisma.speakingInterview.findFirst({ where: { id: interviewId, userId } });
  if (!interview) return null;
  const test = knownTest ?? await getPublicSpeakingTest(interview.testId);
  if (!test) return null;
  const now = Date.now();
  const pipelineStale = ["UPLOADING", "TRANSCRIBING", "EVALUATING"].includes(interview.state)
    && now - interview.stateStartedAt.getTime() > 5 * 60_000;
  const interviewStale = !TERMINAL_INTERVIEW_STATES.includes(interview.state as "COMPLETED" | "FAILED")
    && now - interview.startedAt.getTime() > 2 * 60 * 60_000;
  if (pipelineStale || interviewStale) {
    await markSpeakingFailed(interview.submissionId, interview.id, pipelineStale ? "pipeline_timeout" : "interview_timeout");
    interview = await prisma.speakingInterview.findUniqueOrThrow({ where: { id: interview.id } });
  }
  const prompt = test.prompts.find((item) => item.id === interview!.currentPromptId);
  if (prompt && interview.state.startsWith("PART_")) {
    const elapsed = (Date.now() - interview.stateStartedAt.getTime()) / 1000;
    if (elapsed > prompt.speakingSeconds + TIMER_GRACE_SECONDS) {
      interview = await prisma.speakingInterview.update({
        where: { id: interview.id },
        data: { state: "FAILED", failureReason: "timer_expired", completedAt: new Date() },
      });
      await prisma.submission.update({ where: { id: interview.submissionId }, data: { status: "FAILED" } });
    }
  }
  return snapshotInterview(interview, test);
}

export async function transitionSpeakingInterview(params: {
  userId: string; interviewId: string; action: "BEGIN_PART";
}): Promise<SpeakingInterviewSnapshot | null> {
  const current = await recoverSpeakingInterview(params.userId, params.interviewId);
  if (!current) return null;
  const decision = decideBeginPart(current.state, current.currentPart, current.remainingSeconds);
  if (decision.kind === "IDEMPOTENT") return current;
  if (decision.kind === "REJECT") throw new SpeakingSubmissionStateError(decision.code);
  const changed = await prisma.speakingInterview.updateMany({
    where: { id: current.id, userId: params.userId, state: "PREPARING" },
    data: { state: decision.next as "PART_1", stateStartedAt: new Date() },
  });
  if (changed.count === 0) return recoverSpeakingInterview(params.userId, current.id);
  return recoverSpeakingInterview(params.userId, current.id);
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
  const interview = await createOrResumeSpeakingInterview({ userId, testId });
  if (!interview) return null;
  const prompt = test.prompts.find((p) => p.id === interview.currentPromptId);
  if (!prompt || (promptId && prompt.id !== promptId)) return null;
  return { submissionId: interview.submissionId, prompt };
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
  speakingPart: number;
}): Promise<{ assetId: string; sizeBytes: number; mimeType: string } | null> {
  const { userId, submissionId, data, mimeType, durationSeconds, speakingPart } = params;

  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, userId, module: "SPEAKING" },
    select: {
      id: true,
      status: true,
      speakingResult: { select: { id: true } },
      speakingInterview: true,
      recordings: { select: { id: true, sizeBytes: true, mimeType: true, speakingPart: true } },
    },
  });
  if (!submission) return null;
  if (submission.status !== "PENDING" || submission.speakingResult || !submission.speakingInterview) {
    throw new SpeakingSubmissionStateError("submission_not_editable");
  }
  const interview = await recoverSpeakingInterview(userId, submission.speakingInterview.id);
  if (!interview) return null;
  const existing = submission.recordings.find((recording) => recording.speakingPart === speakingPart);
  if (existing) {
    return { assetId: existing.id, sizeBytes: existing.sizeBytes ?? 0, mimeType: existing.mimeType };
  }
  if (interview.state === "FAILED") throw new SpeakingSubmissionStateError("interview_expired");
  if (speakingPart !== interview.currentPart) throw new SpeakingSubmissionStateError("invalid_transition");
  if (interview.state !== `PART_${interview.currentPart}`) {
    throw new SpeakingSubmissionStateError("invalid_transition");
  }
  const claimed = await prisma.speakingInterview.updateMany({
    where: { id: interview.id, userId, state: interview.state },
    data: { state: "UPLOADING", stateStartedAt: new Date() },
  });
  if (claimed.count !== 1) throw new SpeakingSubmissionStateError("invalid_transition");

  const extension = extensionForMimeType(mimeType);
  const key = newStorageKey(`speaking/${userId}`, extension);
  const storage = getPrivateStorage();
  const stored = await storage.put({ key, data, mimeType });

  let asset: { id: string; sizeBytes: number | null; mimeType: string };
  try {
    asset = await prisma.audioAsset.create({
      data: {
        kind: "SPEAKING_RECORDING",
        storageKey: stored.key,
        url: stored.url,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        durationSeconds: durationSeconds ?? null,
        userId,
        submissionId,
        speakingPart,
      },
      select: { id: true, sizeBytes: true, mimeType: true },
    });
  } catch (error) {
    // Do not leave an orphaned private file if the metadata write fails.
    await storage.delete(stored.key).catch(() => undefined);
    await prisma.speakingInterview.updateMany({
      where: { id: interview.id, state: "UPLOADING" },
      data: { state: interview.state, stateStartedAt: new Date() },
    });
    throw error;
  }

  const test = await getPublicSpeakingTest(interview.testId);
  const nextPart = interview.currentPart + 1;
  const nextPrompt = test && promptForPart(test, nextPart);
  await prisma.speakingInterview.update({
    where: { id: interview.id },
    data: nextPrompt
      ? {
          state: "PREPARING",
          currentPart: nextPart,
          currentPromptId: nextPrompt.id,
          stateStartedAt: new Date(),
        }
      : { state: "TRANSCRIBING", stateStartedAt: new Date() },
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
    include: {
      recordings: { orderBy: [{ speakingPart: "asc" }, { createdAt: "asc" }] },
      speakingResult: true,
      speakingInterview: true,
    },
  });
  if (!submission) return null;

  // Evaluation retries are idempotent. Never call a provider twice or mutate
  // a completed result because the client retried after losing the response.
  if (submission.status === "COMPLETED" && submission.speakingResult) {
    return {
      submissionId,
      status: "COMPLETED",
      isMock: submission.speakingResult.isMock,
      transcript: submission.speakingResult.transcript,
      overall: submission.speakingResult.overall,
    };
  }

  if (!submission.speakingInterview || submission.recordings.length < 3) {
    await markSpeakingFailed(submissionId, submission.speakingInterview?.id, "incomplete_recordings");
    return {
      submissionId,
      status: "FAILED",
      isMock: false,
      transcript: "",
      overall: 0,
      reason: "incomplete_recordings",
    };
  }
  if (!["TRANSCRIBING", "FAILED"].includes(submission.speakingInterview.state)) {
    throw new SpeakingSubmissionStateError("invalid_transition");
  }

  // Atomically claim evaluation. Parallel retries cannot call a provider twice.
  const claimed = await prisma.$transaction(async (tx) => {
    const interviewClaim = await tx.speakingInterview.updateMany({
      where: { id: submission.speakingInterview!.id, state: { in: ["TRANSCRIBING", "FAILED"] } },
      data: { state: "EVALUATING", failureReason: null, stateStartedAt: new Date() },
    });
    if (interviewClaim.count !== 1) return 0;
    const submissionClaim = await tx.submission.updateMany({
      where: { id: submissionId, userId, module: "SPEAKING", status: { in: ["PENDING", "FAILED"] } },
      data: { status: "PROCESSING", processingStartedAt: new Date() },
    });
    return submissionClaim.count;
  });
  if (claimed !== 1) {
    throw new SpeakingSubmissionStateError("evaluation_in_progress");
  }

  let transcript = "";
  let isMock = false;

  try {
    // Providers are resolved inside the try on purpose: a misconfigured
    // provider (AI_MODE=gemini without GEMINI_API_KEY) must fail like any
    // other pipeline error and mark the submission FAILED, never leave it
    // PENDING or crash the route.
    const transcriber = getTranscriptionProvider();
    const grader = getSpeakingGrader();
    isMock = transcriber.isMock || grader.isMock || speakingPipelineIsMock();
    const transcripts: string[] = [];
    for (const recording of submission.recordings) {
      const file = await getPrivateStorage().get(recording.storageKey);
      if (!file) throw new Error("recording_missing");
      const transcription = await transcriber.transcribe({
        audio: file.data,
        mimeType: recording.mimeType,
        language: "en",
      });
      if (!transcription.empty && transcription.transcript.trim()) {
        transcripts.push(`Part ${recording.speakingPart ?? transcripts.length + 1}: ${transcription.transcript.trim()}`);
      }
    }
    transcript = transcripts.join("\n\n");

    if (transcript.trim().length === 0) {
      await markSpeakingFailed(submissionId, submission.speakingInterview.id, "empty_transcript");
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
      part: null,
      feedbackLocale,
    });

    await persistSpeakingResult({ submissionId, transcript, grading, transcriber, isMock });
    await prisma.speakingInterview.update({
      where: { id: submission.speakingInterview.id },
      data: { state: "COMPLETED", completedAt: new Date(), failureReason: null },
    });

    return {
      submissionId,
      status: "COMPLETED",
      isMock,
      transcript,
      overall: grading.overallBand,
    };
  } catch (error) {
    const reason = sanitizeAiText(
      error instanceof SpeakingGradingError
        ? `${error.details.validationStatus}: ${error.details.reason}`
        : error instanceof Error
          ? error.message
          : "unknown_error"
    );
    await markSpeakingFailed(submissionId, submission.speakingInterview.id, reason);

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

async function markSpeakingFailed(submissionId: string, interviewId: string | undefined, reason: string) {
  await prisma.$transaction([
    prisma.submission.updateMany({
      where: { id: submissionId, status: { not: "COMPLETED" } },
      data: { status: "FAILED", processingStartedAt: null },
    }),
    ...(interviewId
      ? [prisma.speakingInterview.updateMany({
          where: { id: interviewId, state: { not: "COMPLETED" } },
          data: { state: "FAILED", failureReason: reason.slice(0, 200), completedAt: new Date() },
        })]
      : []),
  ]);
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
        processingStartedAt: null,
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
  await failStaleSpeakingSubmissions(userId);
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
  await failStaleSpeakingSubmissions(userId);
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

async function failStaleSpeakingSubmissions(userId: string): Promise<void> {
  await prisma.submission.updateMany({
    where: {
      userId,
      module: "SPEAKING",
      OR: [
        { status: "PENDING", createdAt: { lt: new Date(Date.now() - 30 * 60_000) } },
        {
          status: "PROCESSING",
          processingStartedAt: { lt: new Date(Date.now() - 5 * 60_000) },
        },
      ],
    },
    data: { status: "FAILED", processingStartedAt: null },
  });
}
