"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

const LOCALES = [
  { code: "uz", label: "O'z" },
  { code: "ru", label: "Ру" },
];

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function switchTo(code: string) {
    if (code === locale) return;
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: code }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center rounded-lg border border-gray-200 p-0.5" role="group" aria-label="Language">
      {LOCALES.map((l) => (
        <button
          key={l.code}
          onClick={() => switchTo(l.code)}
          disabled={pending}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            locale === l.code ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
