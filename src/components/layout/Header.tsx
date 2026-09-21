import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { LogoutButton } from "./LogoutButton";
import { WorkspaceNav } from "./WorkspaceNav";

export async function Header() {
  const t = await getTranslations("common");
  const session = await getSession();

  return (
    <>
    {session && <WorkspaceNav homeLabel={t("home")} items={[
      {href: "/dashboard", label: t("dashboard")},
      {href: "/full-exam", label: t("fullExam")},
      {href: "/writing", label: t("writing")},
      {href: "/reading", label: t("reading")},
      {href: "/listening", label: t("listening")},
      {href: "/speaking", label: t("speaking")},
    ]} />}
    <header className="workspace-header sticky top-0 z-40 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-xl font-extrabold tracking-tight text-[#20211f]">
          IELTS<span className="text-[#d44d0c]">QA</span>
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
    </>
  );
}
