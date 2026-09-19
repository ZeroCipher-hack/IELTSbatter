import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/auth/session";
import { summarizeError } from "@/lib/ai/sanitize";
import { isIP } from "node:net";

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
  // request.json() throws SyntaxError for malformed JSON. Treat bad client
  // input as a 400 instead of logging it as an internal server failure.
  if (error instanceof SyntaxError) {
    return apiError(400, "invalid_json");
  }
  // Log full details server-side only.
  // Use a bounded, scrubbed summary: stacks and credentials must not reach
  // production logs through malformed provider/database errors.
  console.error("[api] unhandled error:", summarizeError(error));
  return apiError(500, "internal_error", "Something went wrong. Please try again.");
}

export function clientIp(request: Request): string {
  if (process.env.TRUST_PROXY !== "true") return "direct";
  const candidate = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!candidate) return "unknown";
  const closingBracket = candidate.indexOf("]");
  const normalized = candidate.startsWith("[") && closingBracket > 0
    ? candidate.slice(1, closingBracket)
    : candidate.replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, "$1");
  return isIP(normalized) ? normalized : "unknown";
}
