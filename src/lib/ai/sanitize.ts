/**
 * Scrubbing helpers: no secret may ever leave the AI layer through a log,
 * an error message, an API response or a database row.
 */

/**
 * Each rule keeps an optional human-readable prefix (e.g. `?key=`) so the
 * sanitized text stays diagnosable while the credential itself disappears.
 * `hasPrefix` tells the replacer whether group 1 is a prefix (as opposed to
 * a regex offset, which is what a prefix-less pattern would pass in).
 */
const SECRET_RULES: Array<{ pattern: RegExp; hasPrefix: boolean }> = [
  // Google API keys.
  { pattern: /AIza[0-9A-Za-z_-]{10,}/g, hasPrefix: false },
  // ?key=... / &api_key=... in URLs.
  { pattern: /([?&](?:key|api_key|apikey|access_token)=)[^&\s"']+/gi, hasPrefix: true },
  // "apiKey": "..." / api_key=... / password=... in JSON or config text.
  {
    pattern: /("?(?:api[_-]?key|apiKey|access[_-]?token|password|secret)"?\s*[:=]\s*"?)[^",\s}]+/gi,
    hasPrefix: true,
  },
  // Bearer tokens.
  { pattern: /(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, hasPrefix: true },
];

/** Remove anything that looks like a credential from arbitrary text. */
export function sanitizeAiText(text: string): string {
  let output = text;
  for (const { pattern, hasPrefix } of SECRET_RULES) {
    output = output.replace(pattern, hasPrefix ? "$1[redacted]" : "[redacted]");
  }
  return output;
}

/** Short, log-safe description of a provider error (no stack, no secrets). */
export function summarizeError(error: unknown): string {
  if (error instanceof Error) return sanitizeAiText(error.message).slice(0, 500);
  return sanitizeAiText(String(error)).slice(0, 500);
}
