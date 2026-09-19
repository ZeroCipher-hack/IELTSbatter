import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SUPPORTED_LOCALES, LOCALE_COOKIE, type AppLocale } from "@/i18n";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const locale = body?.locale;
  if (!SUPPORTED_LOCALES.includes(locale as AppLocale)) {
    return NextResponse.json({ error: { code: "invalid_locale" } }, { status: 400 });
  }
  (await cookies()).set(LOCALE_COOKIE, locale, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });
  return NextResponse.json({ ok: true });
}
