"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { AudioPlayer } from "@/components/testing/AudioPlayer";
import { QuestionInput, type AnswerValue } from "@/components/testing/QuestionInput";
import type { PublicQuestion, PublicTest } from "@/lib/testing/types";

type SaveState = "idle" | "saving" | "saved" | "error";

interface TestRunnerProps {
  module: "READING" | "LISTENING";
  test: PublicTest;
  attemptId: string;
  startedAt: string;
  initialResponses: Record<string, AnswerValue>;
}

const AUTOSAVE_DELAY_MS = 900;

/**
 * Shared runner for Reading and Listening.
 *
 * Answers live in local state, are autosaved to the server (so a refresh or a
 * crash never loses work) and are graded server-side on submit. The timer is
 * derived from the attempt's server-side start time.
 */
export function TestRunner({ module, test, attemptId, startedAt, initialResponses }: TestRunnerProps) {
  const t = useTranslations("testing");
  const router = useRouter();

  const questions = useMemo(
    () => test.sections.flatMap((section) => section.questions.map((q) => ({ section, question: q }))),
    [test]
  );

  const [responses, setResponses] = useState<Record<string, AnswerValue>>(initialResponses);
  const [activeIndex, setActiveIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    Math.max(0, test.durationMinutes * 60 - elapsedSeconds(startedAt))
  );

  const dirtyIds = useRef<Set<string>>(new Set());
  const responsesRef = useRef(responses);

  /* ------------------------------------------------------------- autosave */

  const flush = useCallback(async (): Promise<boolean> => {
    const ids = Array.from(dirtyIds.current);
    if (ids.length === 0) return true;

    const payload: Record<string, AnswerValue> = {};
    for (const id of ids) payload[id] = responsesRef.current[id] ?? null;

    setSaveState("saving");
    try {
      const response = await fetch(`/api/attempts/${attemptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: payload }),
      });
      if (!response.ok) throw new Error(`save_failed_${response.status}`);
      dirtyIds.current.clear();
      setSaveState("saved");
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  }, [attemptId]);

  const scheduleAutosave = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateAnswer = useCallback(
    (questionId: string, value: AnswerValue) => {
      setResponses((prev) => {
        const next = { ...prev, [questionId]: value };
        responsesRef.current = next;
        return next;
      });
      dirtyIds.current.add(questionId);
      if (scheduleAutosave.current) clearTimeout(scheduleAutosave.current);
      scheduleAutosave.current = setTimeout(() => {
        void flush();
      }, AUTOSAVE_DELAY_MS);
    },
    [flush]
  );

  // Last-chance save when the tab is hidden or closed.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") void flush();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onVisibilityChange);
      if (scheduleAutosave.current) clearTimeout(scheduleAutosave.current);
    };
  }, [flush]);

  /* ---------------------------------------------------------------- timer */

  const submit = useCallback(
    async (auto = false) => {
      if (submitting) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        // Always send the full local snapshot: the server merges it with the
        // autosaved answers and grades the merged set.
        const response = await fetch(`/api/attempts/${attemptId}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ responses: responsesRef.current }),
        });
        if (!response.ok) throw new Error(`submit_failed_${response.status}`);
        router.push(`/${module.toLowerCase()}/result/${attemptId}`);
      } catch {
        setSubmitting(false);
        setSubmitError(auto ? t("errors.autoSubmitFailed") : t("errors.submitFailed"));
      }
    },
    [attemptId, module, router, submitting, t]
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const left = Math.max(0, test.durationMinutes * 60 - elapsedSeconds(startedAt));
      setRemainingSeconds(left);
      if (left === 0) void submit(true);
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt, submit, test.durationMinutes]);

  /* ------------------------------------------------------------------ ui */

  const current = questions[activeIndex];
  const answeredCount = questions.filter(({ question }) => isAnswered(responses[question.id])).length;
  const progressPercent = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;

  function goToQuestionGlobalNumber(number: number) {
    const index = questions.findIndex((entry) => entry.question.number === number);
    if (index >= 0) setActiveIndex(index);
  }

  const saveLabel =
    saveState === "saving"
      ? t("save.saving")
      : saveState === "saved"
        ? t("save.saved")
        : saveState === "error"
          ? t("save.error")
          : t("save.idle");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <div className="space-y-4">
        {/* Sticky status bar */}
        <Card className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <span
              className={`rounded-lg px-3 py-1 font-mono text-sm font-semibold ${
                remainingSeconds <= 300 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-800"
              }`}
              data-testid="timer"
            >
              {formatClock(remainingSeconds)}
            </span>
            <div className="min-w-[120px]">
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-brand-600 transition-all"
                  style={{ width: `${progressPercent}%` }}
                  data-testid="progress-bar"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {t("progressLabel", { answered: answeredCount, total: questions.length })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500" data-testid="save-state">
              {saveLabel}
            </span>
            <Button onClick={() => void submit(false)} disabled={submitting} data-testid="submit">
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </div>
        </Card>

        {submitError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        )}

        {/* Stimulus: passage for Reading, audio for Listening */}
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            {current.section.title}
          </h2>
          {module === "LISTENING" && current.section.audioUrl && (
            <div className="mt-3">
              <AudioPlayer
                key={current.section.audioUrl}
                src={current.section.audioUrl}
                durationSeconds={current.section.audioDurationSeconds}
                title={current.section.title}
              />
            </div>
          )}
          {module === "READING" && current.section.passage && (
            <div className="mt-3 max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-sm leading-7 text-gray-800">
              {current.section.passage}
            </div>
          )}
          {current.section.instructions && (
            <p className="mt-3 whitespace-pre-wrap text-sm font-medium text-gray-600">
              {current.section.instructions}
            </p>
          )}
        </Card>

        {/* Active question */}
        <Card data-testid="question-card">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
              {current.question.number}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">{current.question.prompt}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-gray-400">
                {t(`types.${current.question.type}`)}
              </p>
              <div className="mt-4">
                <QuestionInput
                  question={current.question}
                  value={responses[current.question.id] ?? null}
                  onChange={(value) => updateAnswer(current.question.id, value)}
                />
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <Button
              variant="secondary"
              onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
              disabled={activeIndex === 0}
            >
              {t("previous")}
            </Button>
            {activeIndex < questions.length - 1 ? (
              <Button
                onClick={() => {
                  void flush();
                  setActiveIndex((index) => Math.min(questions.length - 1, index + 1));
                }}
              >
                {t("next")}
              </Button>
            ) : (
              <Button onClick={() => void submit(false)} disabled={submitting}>
                {t("submit")}
              </Button>
            )}
          </div>
        </Card>
      </div>

      {/* Question navigator */}
      <aside className="space-y-4">
        {test.sections.map((section) => (
          <Card key={section.id} className="p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {section.title}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {section.questions.map((question) => {
                const isActive = current.question.id === question.id;
                const answered = isAnswered(responses[question.id]);
                return (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => goToQuestionGlobalNumber(question.number)}
                    title={question.prompt}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-semibold transition-colors ${
                      isActive
                        ? "border-brand-600 bg-brand-600 text-white"
                        : answered
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    {question.number}
                  </button>
                );
              })}
            </div>
          </Card>
        ))}
        <Card className="p-4">
          <p className="text-xs text-gray-500">{t("navigatorHint")}</p>
        </Card>
      </aside>
    </div>
  );
}

function isAnswered(value: AnswerValue): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some((item) => item.trim().length > 0);
  return value.trim().length > 0;
}

function elapsedSeconds(startedAt: string): number {
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.round((Date.now() - started) / 1000));
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
