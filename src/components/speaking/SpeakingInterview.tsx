"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { PublicSpeakingTest, SpeakingInterviewSnapshot, SpeakingPrompt } from "@/lib/speaking/types";

type Phase = "idle" | "preparing" | "recording" | "recorded" | "uploading" | "evaluating" | "evaluation_error" | "error";

interface SpeakingInterviewProps {
  test: PublicSpeakingTest;
  initialInterview: SpeakingInterviewSnapshot;
  locale: string;
}

/**
 * IELTS speaking interview runner.
 *
 * Flow per prompt: preparation timer -> microphone recording (with a speaking
 * timer) -> playback/re-record -> upload -> evaluation -> result page.
 *
 * The recording is uploaded as a file; audio never lives in the database and
 * the evaluation happens server-side.
 */
export function SpeakingInterview({ test, initialInterview, locale }: SpeakingInterviewProps) {
  const t = useTranslations("speaking");
  const router = useRouter();

  const prompts = test.prompts;
  const [interview, setInterview] = useState(initialInterview);
  const [activeId, setActiveId] = useState(initialInterview.currentPromptId);
  const activePrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === activeId) ?? prompts[0],
    [activeId, prompts]
  );
  const partPrompts = useMemo(
    () => prompts.filter((prompt) => prompt.part === interview.currentPart),
    [interview.currentPart, prompts]
  );
  const partSpeakingSeconds = useMemo(
    () => partPrompts.reduce((total, prompt) => total + prompt.speakingSeconds, 0),
    [partPrompts]
  );

  const [phase, setPhase] = useState<Phase>(
    initialInterview.state === "PREPARING" && initialInterview.remainingSeconds > 0 ? "preparing" : "idle"
  );
  const [prepLeft, setPrepLeft] = useState(
    initialInterview.state === "PREPARING" ? initialInterview.remainingSeconds : 0
  );
  const [speakLeft, setSpeakLeft] = useState(
    initialInterview.state.startsWith("PART_")
      ? initialInterview.remainingSeconds
      : prompts
          .filter((prompt) => prompt.part === initialInterview.currentPart)
          .reduce((total, prompt) => total + prompt.speakingSeconds, 0)
  );
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingSize, setRecordingSize] = useState(0);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  /* --------------------------------------------------------------- timers */

  useEffect(() => {
    if (phase !== "preparing") return;
    const timer = setTimeout(() => {
      setPrepLeft((value) => {
        if (value <= 1) {
          setPhase("idle");
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [phase, prepLeft]);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setTimeout(() => {
      setSpeakLeft((value) => {
        if (value <= 1) {
          stopRecording();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [phase, speakLeft, stopRecording]);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------ recording */

  const startRecording = useCallback(async () => {
    if (!activePrompt) return;
    setErrorKey(null);

    try {
      const response = await fetch(`/api/speaking/interviews/${interview.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "BEGIN_PART" }),
      });
      if (!response.ok) throw new Error("invalid_transition");
      const body = (await response.json()) as { interview: SpeakingInterviewSnapshot };
      setInterview(body.interview);
      setSpeakLeft(body.interview.remainingSeconds);
    } catch {
      setErrorKey("errors.submitFailed");
      setPhase("error");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorKey("errors.micUnsupported");
      setPhase("error");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErrorKey("errors.micDenied");
      setPhase("error");
      return;
    }

    streamRef.current = stream;

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        stream.getTracks().forEach((track) => track.stop());
        setErrorKey("errors.recorderUnsupported");
        setPhase("error");
        return;
      }
    }

    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      blobRef.current = blob;
      setRecordingSize(blob.size);
      setRecordingUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(blob);
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setPhase("recorded");
    };

    recorderRef.current = recorder;
    recorder.start();
    recordingStartedAtRef.current = Date.now();
    setPhase("recording");

    // Hard stop at the prompt's speaking limit, with a small grace period.
    const allowedSeconds = Math.max(1, interview.state.startsWith("PART_") ? speakLeft : partSpeakingSeconds);
    stopTimerRef.current = setTimeout(
      () => stopRecording(),
      (allowedSeconds + 2) * 1000
    );
  }, [activePrompt, interview.id, interview.state, partSpeakingSeconds, speakLeft, stopRecording]);

  /* -------------------------------------------------------------- submit */

  async function evaluateSubmission(submissionId: string) {
    setPhase("evaluating");
    try {
      const evaluated = await fetch(`/api/speaking/submissions/${submissionId}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (!evaluated.ok) throw new Error("evaluate_failed");
      router.push(`/speaking/result/${submissionId}`);
    } catch {
      setErrorKey("errors.submitFailed");
      setPhase("evaluation_error");
    }
  }

  async function submitAnswer() {
    if (!activePrompt || !blobRef.current) return;
    setErrorKey(null);
    setPhase("uploading");

    try {
      const submissionId = interview.submissionId;

      const form = new FormData();
      const extension = blobRef.current.type.includes("wav")
        ? "wav"
        : blobRef.current.type.includes("mp4")
          ? "m4a"
          : blobRef.current.type.includes("ogg")
            ? "ogg"
            : "webm";
      form.append("audio", blobRef.current, `answer.${extension}`);
      const recordedSeconds = recordingStartedAtRef.current
        ? Math.max(0, Math.round((Date.now() - recordingStartedAtRef.current) / 1000))
        : 0;
      form.append("durationSeconds", String(recordedSeconds));
      form.append("part", String(interview.currentPart));

      const uploaded = await fetch(`/api/speaking/submissions/${submissionId}/audio`, {
        method: "POST",
        body: form,
      });
      if (!uploaded.ok) throw new Error("upload_failed");

      const recovered = await fetch(`/api/speaking/interviews/${interview.id}`, { cache: "no-store" });
      if (!recovered.ok) throw new Error("recovery_failed");
      const recoveredBody = (await recovered.json()) as { interview: SpeakingInterviewSnapshot };
      setInterview(recoveredBody.interview);

      if (recoveredBody.interview.state === "PREPARING") {
        setActiveId(recoveredBody.interview.currentPromptId);
        setPrepLeft(recoveredBody.interview.remainingSeconds);
        setSpeakLeft(
          prompts
            .filter((prompt) => prompt.part === recoveredBody.interview.currentPart)
            .reduce((total, prompt) => total + prompt.speakingSeconds, 0)
        );
        setRecordingUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return null;
        });
        blobRef.current = null;
        recordingStartedAtRef.current = null;
        setRecordingSize(0);
        setPhase(recoveredBody.interview.remainingSeconds > 0 ? "preparing" : "idle");
        return;
      }
      if (recoveredBody.interview.state !== "TRANSCRIBING") throw new Error("invalid_state");

      await evaluateSubmission(submissionId);
    } catch {
      setErrorKey("errors.submitFailed");
      setPhase("error");
    }
  }

  if (!activePrompt) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <Card>
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
              {t("partLabel", { part: activePrompt.part })}
            </span>
            <span className="text-xs text-gray-500">{activePrompt.partTitle}</span>
          </div>

          <div className="mt-4 space-y-4">
            {partPrompts.map((prompt) => (
              <div key={prompt.id}>
                <p className="text-base font-medium text-gray-900">{prompt.prompt}</p>
                {prompt.bulletPoints.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-6 text-sm text-gray-700">
                    {prompt.bulletPoints.map((point, index) => <li key={index}>{point}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {activePrompt.instructions && (
            <p className="mt-3 text-sm text-gray-500">{activePrompt.instructions}</p>
          )}
        </Card>

        <Card>
          {/* Two clocks: preparation and speaking */}
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">{t("preparation")}</p>
              <p className="font-mono text-2xl font-bold text-gray-900" data-testid="prep-timer">
                {formatClock(prepLeft)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">{t("speaking")}</p>
              <p
                className={`font-mono text-2xl font-bold ${
                  phase === "recording" && speakLeft <= 10 ? "text-red-600" : "text-gray-900"
                }`}
                data-testid="speak-timer"
              >
                {formatClock(speakLeft)}
              </p>
            </div>
            {phase === "recording" && (
              <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
                {t("recordingNow")}
              </span>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {(phase === "idle" || phase === "error") && (
              <Button onClick={() => void startRecording()} data-testid="start-recording">
                {t("startRecording")}
              </Button>
            )}

            {phase === "recording" && (
              <Button variant="danger" onClick={stopRecording} data-testid="stop-recording">
                {t("stopRecording")}
              </Button>
            )}

            {phase === "recorded" && (
              <>
                <Button onClick={() => void submitAnswer()} data-testid="submit-answer">
                  {t("submitAnswer")}
                </Button>
                <Button variant="secondary" onClick={() => void startRecording()}>
                  {t("recordAgain")}
                </Button>
              </>
            )}

            {(phase === "uploading" || phase === "evaluating") && (
              <span className="inline-flex items-center gap-2 text-sm text-gray-600">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                {phase === "uploading" ? t("uploading") : t("evaluating")}
              </span>
            )}

            {phase === "evaluation_error" && (
              <Button onClick={() => void evaluateSubmission(interview.submissionId)}>
                {t("retryEvaluation")}
              </Button>
            )}
          </div>

          {recordingUrl && (
            <div className="mt-5">
              <p className="text-xs uppercase tracking-wide text-gray-500">{t("yourRecording")}</p>
              <audio controls src={recordingUrl} className="mt-2 w-full" data-testid="recording-preview" />
              <p className="mt-1 text-xs text-gray-500">
                {t("recordingSize", { kb: Math.max(1, Math.round(recordingSize / 1024)) })}
              </p>
            </div>
          )}

          {errorKey && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="speaking-error">
              {t(errorKey)}
            </p>
          )}

          <p className="mt-4 text-xs text-gray-500">{t("micHint")}</p>
        </Card>
      </div>

      {/* Prompt navigator */}
      <aside className="space-y-3">
        <Card className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("prompts")}</h3>
          <ol className="mt-3 space-y-2">
            {prompts.map((prompt: SpeakingPrompt) => (
              <li key={prompt.id}>
                <div
                  aria-current={prompt.part === interview.currentPart ? "step" : undefined}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    prompt.part === interview.currentPart
                      ? "border-brand-500 bg-brand-50 text-brand-800"
                      : "border-gray-200 bg-white text-gray-500 opacity-60"
                  }`}
                >
                  <span className="font-semibold">{t("promptNumber", { number: prompt.number })}</span>
                  <span className="mt-0.5 block line-clamp-2">{prompt.prompt}</span>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">{t("structureHint")}</p>
        </Card>
      </aside>
    </div>
  );
}

/** Prefer Opus-in-WebM, fall back to whatever the browser supports. */
function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

function formatClock(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
