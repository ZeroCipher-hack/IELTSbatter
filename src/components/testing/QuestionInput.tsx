"use client";

import { useTranslations } from "next-intl";
import type { PublicQuestion } from "@/lib/testing/types";

export type AnswerValue = string | string[] | null;

interface QuestionInputProps {
  question: PublicQuestion;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
}

/**
 * Renders the input control for one question. Every supported question type is
 * handled here so the test runner stays type-agnostic and new types only need a
 * new branch plus a scoring rule in lib/testing/scoring.ts.
 */
export function QuestionInput({ question, value, onChange }: QuestionInputProps) {
  const t = useTranslations("testing");
  const inputId = `q-${question.id}`;
  const text = typeof value === "string" ? value : "";

  const effectiveOptions = question.options?.length
    ? question.options
    : defaultOptionsFor(question.type, t);

  if (effectiveOptions) {
    return (
      <div className="space-y-2" role="radiogroup" aria-labelledby={`${inputId}-label`}>
        {effectiveOptions.map((option) => {
          const selected = text === option.value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
                selected ? "border-brand-500 bg-brand-50" : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <input
                type="radio"
                name={inputId}
                className="mt-0.5 h-4 w-4 accent-brand-600"
                checked={selected}
                onChange={() => onChange(option.value)}
              />
              <span className="text-gray-800">
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <input
        id={inputId}
        type="text"
        value={text}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("answerPlaceholder")}
        className="block w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      {wordLimitHint(question.meta) && (
        <p className="text-xs text-gray-500">{t("wordLimitHint", { limit: wordLimitHint(question.meta)! })}</p>
      )}
    </div>
  );
}

function wordLimitHint(meta: PublicQuestion["meta"]): number | null {
  const limit = meta && typeof meta === "object" ? (meta as Record<string, unknown>).wordLimit : null;
  return typeof limit === "number" && limit > 0 ? limit : null;
}

/**
 * Built-in option sets for the fixed IELTS answer formats. A test author can
 * still override them per question through `options`.
 */
function defaultOptionsFor(
  type: PublicQuestion["type"],
  t: (key: string) => string
): Array<{ value: string; label: string }> | null {
  if (type === "TRUE_FALSE_NOT_GIVEN") {
    return [
      { value: "TRUE", label: t("answers.true") },
      { value: "FALSE", label: t("answers.false") },
      { value: "NOT_GIVEN", label: t("answers.notGiven") },
    ];
  }
  if (type === "YES_NO_NOT_GIVEN") {
    return [
      { value: "YES", label: t("answers.yes") },
      { value: "NO", label: t("answers.no") },
      { value: "NOT_GIVEN", label: t("answers.notGiven") },
    ];
  }
  return null;
}
