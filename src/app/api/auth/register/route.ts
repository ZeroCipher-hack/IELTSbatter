import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { registerSchema } from "@/lib/validations/auth";
import { apiError, handleApiError, clientIp } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";

export async function POST(request: Request) {
  try {
    if (!rateLimit(`register:${clientIp(request)}`, { limit: 10, windowMs: 60_000 })) {
      return apiError(429, "rate_limited");
    }

    const body = await request.json();
    const input = registerSchema.parse(body);

    const existing = await prisma.user.findUnique({ where: { phone: input.phone } });
    if (existing) {
      return apiError(409, "phone_taken");
    }

    const user = await prisma.user.create({
      data: {
        phone: input.phone,
        name: input.name,
        passwordHash: await hashPassword(input.password),
      },
    });

    await createSession({ userId: user.id, role: user.role });

    return NextResponse.json({ user: { id: user.id, name: user.name, phone: user.phone } }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
