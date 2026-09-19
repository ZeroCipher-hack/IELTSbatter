import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { BandBadge } from "@/components/ui/BandBadge";
import { ProgressChart } from "@/components/dashboard/ProgressChart";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getProgressStats, listOwnSubmissions } from "@/lib/writing/service";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const t = await getTranslations("dashboard");
  const [user, stats, submissions] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } }),
    getProgressStats(session.userId),
    listOwnSubmissions(session.userId),
  ]);

  const averages: Array<[string, number]> = [
    [t("taskResponse"), stats.averageTaskResponse],
    [t("coherence"), stats.averageCoherence],
    [t("vocabulary"), stats.averageLexical],
    [t("grammar"), stats.averageGrammar],
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
            {user && (
              <p className="mt-1 text-sm text-gray-500">
                {t("welcome")}, {user.name}!
              </p>
            )}
          </div>
          <Link
            href="/writing"
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            {t("writeEssay")}
          </Link>
        </div>

        {/* Stat cards */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <Card className="sm:col-span-1 lg:col-span-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t("essaysSubmitted")}
            </p>
            <p className="mt-2 text-3xl font-extrabold text-gray-900">{stats.essaysSubmitted}</p>
          </Card>
          <Card className="sm:col-span-1 lg:col-span-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t("averageOverall")}
            </p>
            <p className="mt-2 text-3xl font-extrabold text-brand-700">
              {stats.essaysSubmitted ? stats.averageOverall.toFixed(1) : "—"}
            </p>
          </Card>
          {averages.map(([label, value]) => (
            <Card key={label}>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
              <p className="mt-2 text-3xl font-extrabold text-gray-900">
                {stats.essaysSubmitted ? value.toFixed(1) : "—"}
              </p>
            </Card>
          ))}
        </div>

        {/* Chart */}
        {stats.history.length > 1 && (
          <Card className="mt-6">
            <h2 className="text-lg font-semibold text-gray-900">{t("progressChart")}</h2>
            <div className="mt-4">
              <ProgressChart data={stats.history} />
            </div>
          </Card>
        )}

        {/* History */}
        <Card className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900">{t("history")}</h2>
          {submissions.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-gray-300 py-12 text-center">
              <p className="text-gray-500">{t("empty")}</p>
              <Link
                href="/writing"
                className="mt-4 inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
              >
                {t("writeEssay")}
              </Link>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-4">{t("date")}</th>
                    <th className="py-2 pr-4">{t("question")}</th>
                    <th className="py-2 pr-4">{t("overall")}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {submissions.map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap py-3 pr-4 text-gray-600">
                        {s.createdAt.toLocaleDateString()}
                      </td>
                      <td className="max-w-md py-3 pr-4 text-gray-800">
                        <span className="line-clamp-2">{s.question}</span>
                      </td>
                      <td className="py-3 pr-4">
                        {s.score ? (
                          <BandBadge band={s.score.overall} />
                        ) : (
                          <span className="text-xs text-gray-400">
                            {t(`status.${s.status}`)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {s.status === "COMPLETED" && (
                          <Link
                            href={`/writing/result/${s.id}`}
                            className="font-medium text-brand-600 hover:underline"
                          >
                            {t("view")}
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
