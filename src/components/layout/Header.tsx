import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { LogoutButton } from "./LogoutButton";

export async function Header() {
  const t = await getTranslations("common");
  const session = await getSession();

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-xl font-bold tracking-tight text-brand-700">
          AXI
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3">
          {session ? (
            <>
              <Link href="/full-exam" className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">{t("fullExam")}</Link>
              <Link
                href="/dashboard"
                className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 md:block"
              >
                {t("dashboard")}
              </Link>
              {(
                [
                  ["writing", "/writing"],
                  ["reading", "/reading"],
                  ["listening", "/listening"],
                  ["speaking", "/speaking"],
                ] as const
              ).map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 lg:block"
                >
                  {t(label)}
                </Link>
              ))}
              <LanguageSwitcher />
              <LogoutButton label={t("logout")} />
            </>
          ) : (
            <>
              <LanguageSwitcher />
              <Link
                href="/login"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                {t("login")}
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                {t("register")}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
