export function generateCspNonce(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function isValidCspNonce(value: string): boolean {
  return /^[A-Za-z0-9+/_-]{16,128}={0,2}$/.test(value);
}

export function buildContentSecurityPolicy(nonce: string, development = false): string {
  if (!isValidCspNonce(nonce)) throw new Error("Invalid CSP nonce");
  const script = [`'nonce-${nonce}'`, "'strict-dynamic'", "https:", "http:"];
  if (development) script.push("'unsafe-eval'");
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/security/csp-report",
  ].join("; ");
}
