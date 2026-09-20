import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { getSession } from "@/lib/auth/session";
import { getOwnSpeakingSubmission } from "@/lib/speaking/service";

const CRITERIA = [
  "fluencyCoherence",
  "lexicalResource",
  "grammaticalRange",
  "pronunciation",
] as const;

/**
 * Speaking result page.
 *
 * Mock evaluations are explicitly labelled MOCK — a development placeholder is
 * never presented as a real AI assessment.
 */
export default async function SpeakingResultPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) redirect("/login");

  const t = await getTranslations("speaking");
  // Ownership enforced in the query: another user's id behaves like a 404.
  const submission = await getOwnSpeakingSubmission(session.userId, params.id);
  if (!submission) notFound();

  const result = submission.speakingResult;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{t("title")}</p>
            <h1 className="text-2xl font-bold text-gray-900">{t("result.title")}</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">{submission.question}</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dashboard"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t("backToDashboard")}
            </Link>
            <Link
              href="/speaking"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {t("tryAgain")}
            </Link>
          </div>
        </div>

        {!result && (
          <Card className="mt-6">
            <p className="text-sm text-gray-600">
              {t("result.notReady")} — <span className="font-medium">{t(`status.${submission.status}`)}</span>
            </p>
          </Card>
        )}

        {result && (
          <>
            {result.isMock && (
              <div
                className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                data-testid="mock-banner"
              >
                <p className="font-semibold uppercase tracking-wide">{t("mockBadge")}</p>
                <p className="mt-1">{t("mockNotice")}</p>
              </div>
            )}

            <Card className="mt-6 flex flex-col items-center py-8">
              <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
                {t("result.overall")}
              </p>
              <p className="mt-2 text-6xl font-extrabold text-brand-700" data-testid="overall-band">
                {result.overall.toFixed(1)}
              </p>
              <p className="mt-3 text-xs text-gray-500">
                {t("result.evaluatedBy", {
                  provider: result.aiProvider,
                  model: result.aiModel,
                })}
              </p>
              <p className="text-xs text-gray-500">
                {t("result.transcribedBy", {
                  provider: result.transcriptionProvider,
                })}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {t("result.attemptDate")}: {submission.createdAt.toLocaleString()}
              </p>
            </Card>

            {/* Criteria */}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {CRITERIA.map((key) => (
                <Card key={key} className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700">{t(`criteria.${key}`)}</p>
                    <span className="text-lg font-bold text-brand-700">
                      {result[key === "grammaticalRange" ? "grammar" : key].toFixed(1)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-2 rounded-full bg-brand-600"
                      style={{ width: `${(result[key === "grammaticalRange" ? "grammar" : key] / 9) * 100}%` }}
                    />
                  </div>
                </Card>
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-500">{t(result.pronunciationSource === "AUDIO" ? "result.pronunciationAudioNotice" : "result.pronunciationNotice")}</p>

            <Card className="mt-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("result.summary")}</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-700">{result.summary}</p>
            </Card>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <Card>
                <h2 className="font-semibold text-emerald-700">{t("result.strengths")}</h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-700">
                  {result.strengths.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </Card>
              <Card>
                <h2 className="font-semibold text-red-700">{t("result.weaknesses")}</h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-700">
                  {result.weaknesses.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </Card>
              <Card>
                <h2 className="font-semibold text-brand-700">{t("result.improvements")}</h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-700">
                  {result.improvements.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </Card>
            </div>

            <Card className="mt-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("result.transcript")}</h2>
              <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-sm leading-7 text-gray-700">
                {result.transcript}
              </p>
            </Card>

            {submission.recordings.length > 0 && (
              <Card className="mt-6">
                <h2 className="text-lg font-semibold text-gray-900">{t("yourRecording")}</h2>
                <audio
                  controls
                  src={`/api/audio/${submission.recordings[0].id}`}
                  className="mt-3 w-full"
                  data-testid="result-audio"
                />
                <p className="mt-2 text-xs text-gray-500">{t("result.audioPrivate")}</p>
              </Card>
            )}
          </>
        )}

        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/speaking"
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
