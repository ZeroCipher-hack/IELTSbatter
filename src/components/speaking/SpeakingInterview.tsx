"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { PublicSpeakingTest, SpeakingPrompt } from "@/lib/speaking/types";

type Phase = "idle" | "preparing" | "recording" | "recorded" | "uploading" | "evaluating" | "error";

interface SpeakingInterviewProps {
  test: PublicSpeakingTest;
  initialPromptId?: string;
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
export function SpeakingInterview({ test, initialPromptId, locale }: SpeakingInterviewProps) {
  const t = useTranslations("speaking");
  const router = useRouter();

  const prompts = test.prompts;
  const [activeId, setActiveId] = useState(initialPromptId ?? prompts[0]?.id ?? "");
  const activePrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === activeId) ?? prompts[0],
    [activeId, prompts]
  );

  const [phase, setPhase] = useState<Phase>("idle");
  const [prepLeft, setPrepLeft] = useState(activePrompt?.preparationSeconds ?? 0);
  const [speakLeft, setSpeakLeft] = useState(activePrompt?.speakingSeconds ?? 0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingSize, setRecordingSize] = useState(0);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the prompt-specific state when the learner switches prompts.
  useEffect(() => {
    setPhase("idle");
    setPrepLeft(activePrompt?.preparationSeconds ?? 0);
    setSpeakLeft(activePrompt?.speakingSeconds ?? 0);
    setErrorKey(null);
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl(null);
    blobRef.current = null;
    setRecordingSize(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  /* --------------------------------------------------------------- timers */

  useEffect(() => {
    if (phase !== "preparing") return;
    if (prepLeft <= 0) {
      // Preparation over — the learner starts the recording when ready.
      setPhase("idle");
      return;
    }
    const timer = setTimeout(() => setPrepLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, prepLeft]);

  useEffect(() => {
    if (phase !== "recording") return;
    if (speakLeft <= 0) {
      stopRecording();
      return;
    }
    const timer = setTimeout(() => setSpeakLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, speakLeft]);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------ recording */

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (!activePrompt) return;
    setErrorKey(null);

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
    setSpeakLeft(activePrompt.speakingSeconds);
    setPhase("recording");

    // Hard stop at the prompt's speaking limit, with a small grace period.
    stopTimerRef.current = setTimeout(
      () => stopRecording(),
      (activePrompt.speakingSeconds + 2) * 1000
    );
  }, [activePrompt, stopRecording]);

  /* -------------------------------------------------------------- submit */

  async function submitAnswer() {
    if (!activePrompt || !blobRef.current) return;
    setErrorKey(null);
    setPhase("uploading");

    try {
      const created = await fetch("/api/speaking/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testId: test.id, promptId: activePrompt.id }),
      });
      if (!created.ok) throw new Error("create_failed");
      const { submissionId } = (await created.json()) as { submissionId: string };

      const form = new FormData();
      const extension = blobRef.current.type.includes("wav")
        ? "wav"
        : blobRef.current.type.includes("mp4")
          ? "m4a"
          : blobRef.current.type.includes("ogg")
            ? "ogg"
            : "webm";
      form.append("audio", blobRef.current, `answer.${extension}`);
      form.append("durationSeconds", String(Math.max(0, activePrompt.speakingSeconds - speakLeft)));

      const uploaded = await fetch(`/api/speaking/submissions/${submissionId}/audio`, {
        method: "POST",
        body: form,
      });
      if (!uploaded.ok) throw new Error("upload_failed");

      setPhase("evaluating");
      const evaluated = await fetch(`/api/speaking/submissions/${submissionId}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (!evaluated.ok) throw new Error("evaluate_failed");

      router.push(`/speaking/result/${submissionId}`);
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

          <p className="mt-4 text-base font-medium text-gray-900">{activePrompt.prompt}</p>

          {activePrompt.bulletPoints.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-6 text-sm text-gray-700">
              {activePrompt.bulletPoints.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          )}

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
            {activePrompt.preparationSeconds > 0 && phase === "idle" && (
              <Button
                variant="secondary"
                onClick={() => {
                  setPrepLeft(activePrompt.preparationSeconds);
                  setPhase("preparing");
                }}
              >
                {t("startPreparation", { seconds: activePrompt.preparationSeconds })}
              </Button>
            )}

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
                <button
                  type="button"
                  onClick={() => setActiveId(prompt.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    prompt.id === activeId
                      ? "border-brand-500 bg-brand-50 text-brand-800"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <span className="font-semibold">{t("promptNumber", { number: prompt.number })}</span>
                  <span className="mt-0.5 block line-clamp-2">{prompt.prompt}</span>
                </button>
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
