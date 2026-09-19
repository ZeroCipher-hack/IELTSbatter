import { NextResponse, type NextRequest } from "next/server";
// Narrow import: the JWT-verify path only (keeps JWE/compression out of
// the Edge Runtime bundle).
import { jwtVerify } from "jose/jwt/verify";
import { buildContentSecurityPolicy, generateCspNonce } from "@/lib/security/csp";

const PROTECTED_PREFIXES = ["/dashboard", "/writing", "/reading", "/listening", "/speaking"];
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
  const nonce = generateCspNonce();
  const policy = buildContentSecurityPolicy(nonce, process.env.NODE_ENV !== "production");
  const requestHeaders = new Headers(request.headers);
  // Next.js reads this request header and attaches the nonce to framework and
  // page scripts. The browser only receives the report-only response header.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const withReportOnly = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy-Report-Only", policy);
    return response;
  };

  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) && !authed) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return withReportOnly(NextResponse.redirect(url));
  }

  if (AUTH_PAGES.includes(pathname) && authed) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return withReportOnly(NextResponse.redirect(url));
  }

  return withReportOnly(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
