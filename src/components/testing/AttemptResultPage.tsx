import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { modulePath } from "@/components/testing/ModuleCatalog";
import { getSession } from "@/lib/auth/session";
import { getOwnAttemptResult, type ObjectiveModule } from "@/lib/testing/service";
import { buildObjectiveFeedback, accuracyPercent } from "@/lib/testing/feedback";
import { publicAnswerLabel } from "@/lib/testing/format";

/**
 * Result page shared by Reading and Listening.
 *
 * Everything shown here comes from the graded attempt stored in the database:
 * the band is the server-side conversion of the raw score, never a client
 * value, and the review compares the learner's answer with the stored key.
 */
export async function AttemptResultPage({
  module,
  attemptId,
}: {
  module: ObjectiveModule;
  attemptId: string;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const t = await getTranslations("testing");
  const result = await getOwnAttemptResult(session.userId, attemptId);
  if (!result) notFound();

  const feedback = buildObjectiveFeedback(result);
  const missed = result.review.filter((item) => !item.isCorrect);
  const path = modulePath(module);
  const moduleLabel = module === "READING" ? t("modules.reading") : t("modules.listening");

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{moduleLabel}</p>
            <h1 className="text-2xl font-bold text-gray-900">{t("result.title")}</h1>
            <p className="mt-1 text-sm text-gray-500">{result.testTitle}</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dashboard"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t("backToDashboard")}
            </Link>
            <Link
              href={`/${path}`}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {t("tryAgain")}
            </Link>
          </div>
        </div>

        {/* Overall */}
        <Card className="mt-6 flex flex-col items-center py-8">
          <p className="text-sm font-medium uppercase tracking-wide text-gray-500">{t("result.overallBand")}</p>
          <p className="mt-2 text-6xl font-extrabold text-brand-700" data-testid="overall-band">
            {result.band.toFixed(1)}
          </p>
          <p className="mt-3 text-sm text-gray-600" data-testid="raw-score">
            {t("result.rawScore", {
              raw: result.rawScore,
              max: result.maxScore,
              correct: result.correctCount,
              total: result.totalQuestions,
            })}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {t("result.accuracy", { percent: accuracyPercent(result.correctCount, result.totalQuestions) })}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs text-gray-500">
            <span>
              {t("result.attemptDate")}:{" "}
              {(result.submittedAt ?? result.startedAt).toLocaleString()}
            </span>
            {result.timeSpentSeconds != null && (
              <span>
                {t("result.timeSpent")}: {formatDuration(result.timeSpentSeconds)}
              </span>
            )}
          </div>
        </Card>

        {/* Section breakdown */}
        <Card className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900">{t("result.breakdown")}</h2>
          <ul className="mt-4 space-y-3">
            {result.scoresBySection.map((section) => (
              <li key={section.sectionId}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-800">{section.title}</span>
                  <span className="font-medium text-gray-700">
                    {section.correct}/{section.total}
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-2 rounded-full bg-brand-600"
                    style={{ width: `${accuracyPercent(section.correct, section.total)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>

          <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
            {t("result.byQuestionType")}
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {feedback.typeBreakdown.map((entry) => (
              <li
                key={entry.type}
                className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <span className="text-gray-700">{t(`types.${entry.type}`)}</span>
                <span className="font-medium text-gray-900">
                  {entry.correct}/{entry.total}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Strengths / weaknesses / recommendations — deterministic, not AI */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card>
            <h2 className="font-semibold text-emerald-700">{t("result.strengths")}</h2>
            {feedback.strengths.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">{t("result.noStrengths")}</p>
            ) : (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-700">
                {feedback.strengths.map((entry) => (
                  <li key={entry.type}>
                    {t("result.strengthLine", {
                      type: t(`types.${entry.type}`),
                      correct: entry.correct,
                      total: entry.total,
                    })}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="font-semibold text-red-700">{t("result.weaknesses")}</h2>
            {feedback.weaknesses.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">{t("result.noWeaknesses")}</p>
            ) : (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-700">
                {feedback.weaknesses.map((entry) => (
                  <li key={entry.type}>
                    {t("result.weaknessLine", {
                      type: t(`types.${entry.type}`),
                      correct: entry.correct,
                      total: entry.total,
                    })}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="font-semibold text-brand-700">{t("result.recommendations")}</h2>
            {feedback.recommendations.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">{t("result.noRecommendations")}</p>
            ) : (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-700">
                {feedback.recommendations.map((type) => (
                  <li key={type}>{t(`recommendations.${type}`)}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Mistakes */}
        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{t("result.mistakes")}</h2>
            <span className="text-sm text-gray-500">{t("result.mistakeCount", { count: missed.length })}</span>
          </div>
          {missed.length === 0 ? (
            <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {t("result.noMistakes")}
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {missed.map((item) => (
                <li key={item.questionId} className="rounded-lg border border-red-100 bg-red-50/40 p-4">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">
                      {item.number}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{item.prompt}</p>
                      <p className="mt-2 text-sm text-gray-700">
                        <span className="font-medium">{t("result.yourAnswer")}: </span>
                        <span className="text-red-700">{publicAnswerLabel(item.given) || t("result.blank")}</span>
                      </p>
                      <p className="text-sm text-gray-700">
                        <span className="font-medium">{t("result.correctAnswer")}: </span>
                        <span className="text-emerald-700">{item.correctAnswers.join(" / ")}</span>
                      </p>
                      {item.explanation && (
                        <p className="mt-2 rounded-md bg-white px-3 py-2 text-sm text-gray-600">
                          <span className="font-medium">{t("result.explanation")}: </span>
                          {item.explanation}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Full review */}
        <Card className="mt-6">
          <details>
            <summary className="cursor-pointer text-lg font-semibold text-gray-900">
              {t("result.fullReview")}
            </summary>
            <ul className="mt-4 divide-y divide-gray-100">
              {result.review.map((item) => (
                <li key={item.questionId} className="flex flex-wrap items-start gap-3 py-3">
                  <span
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                      item.isCorrect ? "bg-emerald-600" : "bg-red-600"
                    }`}
                  >
                    {item.number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800">{item.prompt}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {t("result.yourAnswer")}: {publicAnswerLabel(item.given) || t("result.blank")} ·{" "}
                      {t("result.correctAnswer")}: {item.correctAnswers.join(" / ")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        </Card>

        <div className="mt-6 flex justify-center gap-3">
          <Link
            href={`/${path}/${result.testId}`}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            {t("result.retry")}
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            {t("backToDashboard")}
          </Link>
        </div>
      </main>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}
