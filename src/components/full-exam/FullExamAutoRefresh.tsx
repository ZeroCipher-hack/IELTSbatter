"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function FullExamAutoRefresh({ enabled }: { enabled: boolean }) { const router = useRouter(); useEffect(() => { if (!enabled) return; const timer = setInterval(() => router.refresh(), 3000); return () => clearInterval(timer); }, [enabled, router]); return null; }
