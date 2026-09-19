import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { getSession } from "@/lib/auth/session";
import { getSpeakingProgress, listSpeakingTests } from "@/lib/speaking/service";

export default async function SpeakingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const t = await getTranslations("speaking");
  const [tests, progress] = await Promise.all([
    listSpeakingTests(),
    getSpeakingProgress(session.userId),
  ]);

  const gradedCount = progress.history.filter((item) => item.status === "COMPLETED").length;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
            <p className="mt-1 text-sm text-gray-500">{t("subtitle")}</p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t("backToDashboard")}
          </Link>
        </div>

        {progress.isMock && gradedCount > 0 && (
          <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="mock-banner">
            {t("mockNotice")}
          </div>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t("attempts")}</p>
            <p className="mt-2 text-2xl font-extrabold text-gray-900">{progress.attempts}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t("latestBand")}</p>
            <p className="mt-2 text-2xl font-extrabold text-brand-700">
              {progress.latestBand != null ? progress.latestBand.toFixed(1) : "—"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t("bestBand")}</p>
            <p className="mt-2 text-2xl font-extrabold text-gray-900">
              {progress.bestBand != null ? progress.bestBand.toFixed(1) : "—"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t("improvement")}</p>
            <p className="mt-2 text-2xl font-extrabold text-gray-900">
              {progress.improvement != null
                ? `${progress.improvement > 0 ? "+" : ""}${progress.improvement.toFixed(1)}`
                : "—"}
            </p>
          </Card>
        </div>

        <Card className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900">{t("availableTests")}</h2>
          {tests.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500">
              {t("noTests")}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-gray-100">
              {tests.map((test) => (
                <li key={test.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{test.title}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {t("testMeta", {
                        parts: test.partCount,
                        prompts: test.promptCount,
                        minutes: test.estimatedMinutes,
                      })}
                    </p>
                    {test.description && <p className="mt-1 text-sm text-gray-600">{test.description}</p>}
                  </div>
                  <Link
                    href={`/speaking/${test.id}`}
                    className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    {t("startTest")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900">{t("history")}</h2>
          {progress.history.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">{t("noHistory")}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-4">{t("date")}</th>
                    <th className="py-2 pr-4">{t("prompt")}</th>
                    <th className="py-2 pr-4">{t("overall")}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...progress.history].reverse().map((item) => (
                    <tr key={item.submissionId}>
                      <td className="whitespace-nowrap py-3 pr-4 text-gray-600">
                        {new Date(item.date).toLocaleDateString()}
                      </td>
                      <td className="max-w-md py-3 pr-4 text-gray-800">
                        <span className="line-clamp-2">{item.question}</span>
                      </td>
                      <td className="py-3 pr-4">
                        {item.status === "COMPLETED" ? (
                          <span className="font-semibold text-gray-900">
                            {item.overall.toFixed(1)}
                            {item.isMock && (
                              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                                {t("mockBadge")}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">{t(`status.${item.status}`)}</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {item.status === "COMPLETED" && (
                          <Link
                            href={`/speaking/result/${item.submissionId}`}
                            className="font-medium text-brand-600 hover:underline"
                          >
                            {t("viewResult")}
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
