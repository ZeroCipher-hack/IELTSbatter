import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { CriteriaGrid } from "@/components/writing/CriteriaGrid";
import { getSession } from "@/lib/auth/session";
import { getOwnSubmission } from "@/lib/writing/service";

const CATEGORY_KEYS = ["grammar", "vocabulary", "spelling", "punctuation", "style", "coherence"] as const;

export default async function ResultPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const t = await getTranslations("result");
  // Ownership enforced in the query: users can only see their own results.
  const submission = await getOwnSubmission(session.userId, params.id);
  if (!submission || !submission.score || !submission.feedback) notFound();

  const { score, feedback, errors } = submission;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
          <div className="flex gap-2">
            <Link
              href="/dashboard"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t("backToDashboard")}
            </Link>
            <Link
              href="/writing"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {t("writeAnother")}
            </Link>
          </div>
        </div>

        {/* Overall */}
        <Card className="mt-6 flex flex-col items-center py-10">
          <p className="text-sm font-medium uppercase tracking-wide text-gray-500">{t("overall")}</p>
          <p className="mt-2 text-6xl font-extrabold text-brand-700">{score.overall.toFixed(1)}</p>
        </Card>

        {/* Criteria */}
        <div className="mt-6">
          <CriteriaGrid
            items={[
              { key: "taskResponse", band: score.taskResponse, note: feedback.taskResponseNote },
              { key: "coherenceCohesion", band: score.coherenceCohesion, note: feedback.coherenceCohesionNote },
              { key: "lexicalResource", band: score.lexicalResource, note: feedback.lexicalResourceNote },
              { key: "grammar", band: score.grammar, note: feedback.grammarNote },
            ]}
          />
        </div>

        {/* Summary */}
        <Card className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900">{t("summary")}</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-700">{feedback.summary}</p>
        </Card>

        {/* Strengths / weaknesses / improvements */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card>
            <h2 className="font-semibold text-emerald-700">{t("strengths")}</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-gray-700">
              {feedback.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="font-semibold text-red-700">{t("weaknesses")}</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-gray-700">
              {feedback.weaknesses.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="font-semibold text-brand-700">{t("improvements")}</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-gray-700">
              {feedback.improvements.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </Card>
        </div>

        {/* Errors */}
        <Card className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900">{t("errorsTitle")}</h2>
          {errors.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">{t("noErrors")}</p>
          ) : (
            <div className="mt-4 space-y-4">
              {errors.map((e) => (
                <div key={e.id} className="rounded-lg border border-gray-200 p-4">
                  <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                    {CATEGORY_KEYS.includes(e.category as (typeof CATEGORY_KEYS)[number])
                      ? t(`categories.${e.category}`)
                      : e.category}
                  </span>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-red-500">
                        {t("original")}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-gray-800 line-through decoration-red-300">
                        {e.originalText}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-emerald-600">
                        {t("correction")}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-gray-800">{e.correction}</p>
                    </div>
                  </div>
                  <p className="mt-3 border-t border-gray-100 pt-3 text-sm leading-6 text-gray-600">
                    <span className="font-medium text-gray-700">{t("explanation")}: </span>
                    {e.explanation}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Essay */}
        <Card className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900">{t("yourEssay")}</h2>
          <p className="mt-2 text-sm text-gray-500">
            {t("question")}: {submission.question}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {submission.wordCount} {t("words")}
          </p>
          <p className="mt-4 whitespace-pre-wrap font-serif text-base leading-7 text-gray-800">
            {submission.essay}
          </p>
        </Card>
      </main>
    </div>
  );
}
