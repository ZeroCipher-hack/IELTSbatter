"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
export function StartFullExamButton() {
  const t = useTranslations("fullExam"); const router = useRouter(); const [loading, setLoading] = useState(false); const [error, setError] = useState(false);
  async function start() { if (loading) return; setLoading(true); setError(false); try { const response = await fetch("/api/full-exams", { method: "POST" }); const data = await response.json().catch(() => null); if (!response.ok || !data?.exam?.id) throw new Error("start_failed"); router.push(`/full-exam/${data.exam.id}`); } catch { setError(true); setLoading(false); } }
  return <div><Button size="lg" onClick={() => void start()} disabled={loading}>{loading ? t("starting") : t("start")}</Button>{error ? <p className="mt-2 text-sm text-red-700" role="alert">{t("startError")}</p> : null}</div>;
}
