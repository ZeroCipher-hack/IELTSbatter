import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { StartFullExamButton } from "@/components/full-exam/StartFullExamButton";
import { getSession } from "@/lib/auth/session";
import { listOwnFullExams } from "@/lib/full-exam/service";
export default async function FullExamPage() {
  const session = await getSession(); if (!session) redirect("/login"); const [t, exams] = await Promise.all([getTranslations("fullExam"), listOwnFullExams(session.userId)]);
  return <div className="min-h-screen bg-gray-50"><Header /><main className="mx-auto max-w-5xl px-4 py-10"><Card className="overflow-hidden bg-gradient-to-br from-brand-700 to-indigo-950 text-white"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-200">{t("eyebrow")}</p><h1 className="mt-3 text-3xl font-extrabold">{t("title")}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-indigo-100">{t("description")}</p><div className="mt-6"><StartFullExamButton /></div></Card><Card className="mt-6"><h2 className="text-lg font-semibold text-gray-900">{t("history")}</h2>{exams.length === 0 ? <p className="mt-4 text-sm text-gray-500">{t("noHistory")}</p> : <div className="mt-4 divide-y divide-gray-100">{exams.map((exam) => <Link key={exam.id} href={`/full-exam/${exam.id}`} className="flex items-center justify-between gap-4 py-4 hover:text-brand-700"><div><p className="font-medium">{exam.startedAt.toLocaleString()}</p><p className="text-xs text-gray-500">{t(`status.${exam.status}`)}</p></div><span className="text-2xl font-extrabold">{exam.overallBand?.toFixed(1) ?? "—"}</span></Link>)}</div>}</Card></main></div>;
}
