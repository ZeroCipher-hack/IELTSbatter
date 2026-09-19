import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/auth/session";

/** Uniform JSON error shape. Never leaks internals or secrets. */
export function apiError(status: number, code: string, message?: string): NextResponse {
  return NextResponse.json({ error: { code, message: message ?? code } }, { status });
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return apiError(401, "unauthorized");
  }
  if (error instanceof ZodError) {
    const first = error.errors[0];
    return apiError(400, "validation_error", first ? `${first.path.join(".")}: ${first.message}` : undefined);
  }
  // Log full details server-side only.
  console.error("[api] unhandled error:", error instanceof Error ? error.stack : error);
  return apiError(500, "internal_error", "Something went wrong. Please try again.");
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "unknown";
}
