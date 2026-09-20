import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { EssayEditor } from "@/components/writing/EssayEditor";
import { env } from "@/lib/env";
import { getSession } from "@/lib/auth/session";
import { FullExamStateError, requireFullExamModuleAccess } from "@/lib/full-exam/service";
import { notFound, redirect } from "next/navigation";

export default async function WritingPage(props: { searchParams: Promise<{ fullExamId?: string }> }) {
  const t = await getTranslations("writing");
  const search = await props.searchParams;
  const fullExamSessionId = search.fullExamId ?? null;
  if (fullExamSessionId) {
    const session = await getSession(); if (!session) redirect("/login");
    try { await requireFullExamModuleAccess(session.userId, fullExamSessionId, "WRITING"); }
    catch (error) { if (error instanceof FullExamStateError) notFound(); throw error; }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
        <div className="mt-6">
          <EssayEditor minWords={env.writingMinWords} fullExamSessionId={fullExamSessionId} />
        </div>
      </main>
    </div>
  );
}
