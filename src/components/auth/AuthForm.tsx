"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [phone, setPhone] = useState("+998 ");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "register" ? { phone, name, password } : { phone, password }
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const code: string = data?.error?.code ?? "generic";
        const message: string = data?.error?.message ?? "";
        // Map validation errors to friendly, localized messages.
        const known = [
          "invalid_phone",
          "name_too_short",
          "password_too_short",
          "password_required",
          "phone_taken",
          "invalid_credentials",
          "rate_limited",
        ];
        const match = known.find((k) => code === k || message.includes(k));
        setError(t(`errors.${match ?? "generic"}`));
        return;
      }
      const next = searchParams.get("next");
      router.push(next && next.startsWith("/") ? next : "/dashboard");
      router.refresh();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <h1 className="text-2xl font-bold text-gray-900">
        {mode === "login" ? t("loginTitle") : t("registerTitle")}
      </h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Input
          id="phone"
          label={t("phone")}
          placeholder={t("phonePlaceholder")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          inputMode="tel"
          required
        />
        {mode === "register" && (
          <Input
            id="name"
            label={t("name")}
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
        )}
        <Input
          id="password"
          type="password"
          label={t("password")}
          placeholder={t("passwordPlaceholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
        />
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? "..." : mode === "login" ? t("loginButton") : t("registerButton")}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-600">
        {mode === "login" ? (
          <>
            {t("noAccount")}{" "}
            <Link href="/register" className="font-medium text-brand-600 hover:underline">
              {t("registerButton")}
            </Link>
          </>
        ) : (
          <>
            {t("haveAccount")}{" "}
            <Link href="/login" className="font-medium text-brand-600 hover:underline">
              {t("loginButton")}
            </Link>
          </>
        )}
      </p>
    </Card>
  );
}
