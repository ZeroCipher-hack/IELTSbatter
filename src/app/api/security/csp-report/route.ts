import { apiError, clientIp, handleApiError } from "@/lib/utils/api";
import { rateLimit } from "@/lib/utils/rate-limit";

const MAX_REPORT_BYTES = 16 * 1024;

function boundedText(value: unknown, max = 300): string | undefined {
  return typeof value === "string" ? value.slice(0, max).replace(/[\r\n]/g, " ") : undefined;
}

function safeBlockedResource(value: unknown): string | undefined {
  const text = boundedText(value, 500);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return `${url.origin}${url.pathname}`.slice(0, 120);
  } catch {
    return /^(inline|eval|self|data|blob)$/.test(text) ? text : "other";
  }
}

export async function POST(request: Request) {
  try {
    if (!(await rateLimit(`csp:${clientIp(request)}`, { limit: 60, windowMs: 60_000 }))) {
      return apiError(429, "rate_limited");
    }
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_REPORT_BYTES) return apiError(413, "report_too_large");
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_REPORT_BYTES) return apiError(413, "report_too_large");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const report = (parsed["csp-report"] ?? parsed.body ?? parsed) as Record<string, unknown>;
    // Deliberately omit document URLs, query strings and script samples.
    console.warn("[csp-report]", {
      directive: boundedText(report["violated-directive"] ?? report.effectiveDirective),
      blocked: safeBlockedResource(report["blocked-uri"] ?? report.blockedURL),
      disposition: boundedText(report.disposition, 30),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
