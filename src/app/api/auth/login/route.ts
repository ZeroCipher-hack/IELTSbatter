import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validations/auth";
import { apiError, handleApiError, clientIp } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";

// Public, precomputed bcrypt value used only to keep unknown-user and
// wrong-password requests on the same expensive verification path.
const DUMMY_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export async function POST(request: Request) {
  try {
    if (!rateLimit(`login:${clientIp(request)}`, { limit: 15, windowMs: 60_000 })) {
      return apiError(429, "rate_limited");
    }

    const body = await request.json();
    const input = loginSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { phone: input.phone } });
    const passwordMatches = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH
    );
    // Same error for unknown phone and wrong password — no user enumeration.
    if (!user || !passwordMatches) {
      return apiError(401, "invalid_credentials");
    }

    await createSession({ userId: user.id, role: user.role });

    return NextResponse.json({ user: { id: user.id, name: user.name, phone: user.phone } });
  } catch (error) {
    return handleApiError(error);
  }
}
