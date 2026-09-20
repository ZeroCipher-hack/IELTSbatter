"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const SAMPLE_QUESTIONS = [
  "Some people believe that it is the responsibility of individuals to take care of their own health and diet. Others however believe that governments should make sure that their citizens have a healthy diet. Discuss both views and give your opinion.",
  "An increasing number of professionals, such as doctors and teachers, are leaving their own poorer countries to work in developed countries. What problems does this cause? What solutions can you suggest to deal with this situation?",
  "Young people are leaving their homes in rural areas to work or study in cities. What are the reasons? Do the advantages of this development outweigh the drawbacks?",
  "Some people think that all university students should study whatever they like. Others believe that they should only be allowed to study subjects that will be useful in the future, such as those related to science and technology. Discuss both these views and give your own opinion.",
];

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function EssayEditor({ minWords, fullExamSessionId = null }: { minWords: number; fullExamSessionId?: string | null }) {
  const t = useTranslations("writing");
  const locale = useLocale();
  const router = useRouter();

  const [question, setQuestion] = useState("");
  const [essay, setEssay] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stable across transport retries; replaced only after a successful submit.
  const idempotencyKey = useRef<string | null>(null);

  const wordCount = useMemo(() => countWords(essay), [essay]);
  const belowMin = essay.trim().length > 0 && wordCount < minWords;

  function useSample() {
    const q = SAMPLE_QUESTIONS[Math.floor(Math.random() * SAMPLE_QUESTIONS.length)];
    setQuestion(q);
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      idempotencyKey.current ??= crypto.randomUUID();
      const res = await fetch("/api/writing/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-axi-locale": locale,
          "Idempotency-Key": idempotencyKey.current,
          ...(fullExamSessionId ? { "x-full-exam-id": fullExamSessionId } : {}),
        },
        body: JSON.stringify({ question, essay, testType: "TASK_2" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const code: string = data?.error?.code ?? "generic";
        const message: string = data?.error?.message ?? "";
        const known = [
          "question_too_short",
          "essay_too_short",
          "essay_too_short_words",
          "grading_failed",
          "rate_limited",
        ];
        const match = known.find((k) => code === k || message.includes(k));
        setError(
          match
            ? t(`errors.${match}`, { min: minWords })
            : t("errors.generic")
        );
        return;
      }
      idempotencyKey.current = null;
      router.push(fullExamSessionId ? `/full-exam/${fullExamSessionId}` : `/writing/result/${data.submissionId}`);
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="question" className="text-sm font-semibold text-gray-800">
            {t("questionLabel")}
          </label>
          <Button variant="secondary" size="sm" onClick={useSample} type="button">
            {t("useSample")}
          </Button>
        </div>
        <textarea
          id="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("questionPlaceholder")}
          rows={3}
          className="mt-3 block w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="essay" className="text-sm font-semibold text-gray-800">
            {t("essayLabel")}
          </label>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              belowMin ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"
            }`}
            aria-live="polite"
          >
            {t("wordCount")}: {wordCount}
          </span>
        </div>
        <textarea
          id="essay"
          value={essay}
          onChange={(e) => setEssay(e.target.value)}
          placeholder={t("essayPlaceholder")}
          rows={16}
          className="mt-3 block w-full resize-y rounded-lg border border-gray-300 px-4 py-3 font-serif text-base leading-7 shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        {belowMin && (
          <p className="mt-2 text-sm text-amber-700">
            {t("minWordsWarning", { min: minWords })}
          </p>
        )}
      </Card>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={submit}
          disabled={submitting || question.trim().length < 10 || essay.trim().length < 50}
        >
          {submitting && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          )}
          {submitting ? t("submitting") : t("submit")}
        </Button>
      </div>
    </div>
  );
}
