import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { SpeakingInterview } from "@/components/speaking/SpeakingInterview";
import { getSession } from "@/lib/auth/session";
import { createOrResumeSpeakingInterview, getPublicSpeakingTest } from "@/lib/speaking/service";

export default async function SpeakingTestPage(
  props: {
    params: Promise<{ testId: string }>;
  }
) {
  const params = await props.params;
  const session = await getSession();
  if (!session) redirect("/login");

  const t = await getTranslations("speaking");
  const test = await getPublicSpeakingTest(params.testId);
  if (!test) notFound();
  const interview = await createOrResumeSpeakingInterview({
    userId: session.userId,
    testId: params.testId,
  });
  if (!interview) notFound();

  // Feedback language follows the UI locale cookie (same as the Writing flow).
  const locale = (await cookies()).get("axi_locale")?.value === "ru" ? "ru" : "uz";

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{t("title")}</p>
            <h1 className="text-xl font-bold text-gray-900">{test.title}</h1>
          </div>
          <Link
            href="/speaking"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t("exitTest")}
          </Link>
        </div>

        <div className="mt-6">
          <SpeakingInterview test={test} locale={locale} initialInterview={interview} />
        </div>
      </main>
    </div>
  );
}
