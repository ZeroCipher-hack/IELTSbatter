import { NextResponse, type NextRequest } from "next/server";
// Narrow import: the JWT-verify path only (keeps JWE/compression out of
// the Edge Runtime bundle).
import { jwtVerify } from "jose/jwt/verify";

const PROTECTED_PREFIXES = ["/dashboard", "/writing"];
const AUTH_PAGES = ["/login", "/register"];

async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("axi_session")?.value;
  const authed = await verifySession(token);

  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) && !authed) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (AUTH_PAGES.includes(pathname) && authed) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/writing/:path*", "/login", "/register"],
};
