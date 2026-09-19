import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

// Cookie/session based: always evaluated per request.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, phone: true, locale: true },
  });
  return NextResponse.json({ user });
}
