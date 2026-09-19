import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/Card";

export type OverviewModule = "WRITING" | "READING" | "LISTENING" | "SPEAKING";

export interface ModuleOverviewItem {
  module: OverviewModule;
  /** Module landing page ("/reading", ...). */
  href: string;
  latestBand: number | null;
  previousBand: number | null;
  bestBand: number | null;
  attempts: number;
  /** Link to the newest result, when one exists. */
  latestResultHref: string | null;
  /** True when the shown band comes from a mock provider (must be labelled). */
  isMock?: boolean;
}

/**
 * Dashboard module overview.
 *
 * Every number comes from the database (submissions / attempts); nothing here
 * is mocked, and a module with no attempts is shown as empty rather than as
 * a placeholder score.
 */
export async function ModuleOverview({
  items,
  overallBand,
}: {
  items: ModuleOverviewItem[];
  overallBand: number | null;
}) {
  const t = await getTranslations("dashboard");
  const tTesting = await getTranslations("testing");

  return (
    <Card className="mt-6" data-testid="module-overview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{t("modulesTitle")}</h2>
          <p className="mt-1 text-xs text-gray-500">{t("modulesSubtitle")}</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-4 py-2 text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t("overallBand")}</p>
          <p className="text-2xl font-extrabold text-brand-700" data-testid="overall-band">
            {overallBand != null ? overallBand.toFixed(1) : "—"}
          </p>
          <p className="text-[10px] text-gray-400">{t("overallNote")}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => {
          const improvement =
            item.latestBand != null && item.previousBand != null
              ? Math.round((item.latestBand - item.previousBand) * 10) / 10
              : null;

          return (
            <div
              key={item.module}
              className="flex flex-col justify-between rounded-xl border border-gray-200 p-4"
              data-testid={`module-card-${item.module}`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">
                    {tTesting(`modules.${item.module.toLowerCase()}`)}
                  </p>
                  {item.isMock && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                      {t("mockShort")}
                    </span>
                  )}
                </div>

                <p className="mt-3 text-3xl font-extrabold text-gray-900">
                  {item.latestBand != null ? item.latestBand.toFixed(1) : "—"}
                  <span className="ml-2 align-middle text-xs font-medium text-gray-500">{t("latest")}</span>
                </p>

                <dl className="mt-3 space-y-1 text-xs text-gray-600">
                  <div className="flex justify-between">
                    <dt>{t("previous")}</dt>
                    <dd className="font-medium">
                      {item.previousBand != null ? item.previousBand.toFixed(1) : "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>{t("improvementShort")}</dt>
                    <dd
                      className={`font-medium ${
                        improvement == null ? "" : improvement > 0 ? "text-emerald-700" : improvement < 0 ? "text-red-700" : ""
                      }`}
                    >
                      {improvement != null ? `${improvement > 0 ? "+" : ""}${improvement.toFixed(1)}` : "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>{t("attemptsShort")}</dt>
                    <dd className="font-medium">{item.attempts}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>{t("bestBand")}</dt>
                    <dd className="font-medium">{item.bestBand != null ? item.bestBand.toFixed(1) : "—"}</dd>
                  </div>
                </dl>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={item.href}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                >
                  {item.attempts > 0 ? t("openModule") : t("startModule")}
                </Link>
                {item.latestResultHref && (
                  <Link
                    href={item.latestResultHref}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {t("viewLatestResult")}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Mean of the module bands that have at least one graded attempt. */
export function computeDashboardOverall(items: ModuleOverviewItem[]): number | null {
  const bands = items
    .map((item) => item.latestBand)
    .filter((band): band is number => band != null);
  if (bands.length === 0) return null;
  return Math.round((bands.reduce((sum, band) => sum + band, 0) / bands.length) * 10) / 10;
}
