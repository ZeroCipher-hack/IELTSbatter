// Narrow imports: JWT sign/verify only (no JWE/compression in the bundle).
import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

const COOKIE_NAME = "axi_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  userId: string;
  role: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret);
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ userId: payload.userId, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.userId !== "string") return null;
    return { userId: payload.userId, role: String(payload.role ?? "USER") };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

/** For API routes: returns session or throws a 401-style error object. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw new UnauthorizedError();
  }
  return session;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}
