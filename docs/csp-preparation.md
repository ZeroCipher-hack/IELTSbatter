# CSP preparation audit

Status: report-only. Enforcement is intentionally deferred until production
violation data has been reviewed.

## Architecture

- `src/proxy.ts` creates a cryptographically random nonce for every document request.
- The nonce and CSP are forwarded as request headers so Next.js can nonce its
  framework and page scripts.
- Browsers receive only `Content-Security-Policy-Report-Only`.
- Reports are accepted at `/api/security/csp-report`, size/rate limited and
  logged without document URLs, query strings or script samples.
- API, static asset, image optimization and prefetch requests are excluded.

## Inline dependency audit

- Next.js bootstrap and streamed App Router scripts require nonce propagation.
- No application use of `dangerouslySetInnerHTML` was found.
- Tailwind/React styling currently requires `style-src 'unsafe-inline'`; this
  must be removed or explicitly accepted before CSP enforcement.
- Development requires `script-src 'unsafe-eval'`; production policy omits it.
- Nonce-based rendering makes matched pages dynamic and prevents static HTML
  caching. Measure the production impact before enforcement.

## Enforcement gate

Do not replace report-only with enforcing CSP until sampled violations show no
required blocked resources, script nonces are verified in production HTML, and
authentication plus all four IELTS module flows pass authenticated E2E.
