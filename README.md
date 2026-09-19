# AXI — AI-powered IELTS Writing Assessment Platform

AXI is a web platform for IELTS candidates in Uzbekistan. Users write an IELTS
Writing Task 2 essay, and AI grades it against the official IELTS Writing Band
Descriptors:

- **Task Response**
- **Coherence & Cohesion**
- **Lexical Resource**
- **Grammatical Range & Accuracy**

The platform returns per-criterion band scores, a server-computed overall band
(official IELTS rounding), concrete error corrections, detailed feedback, and
tracks progress over time.

**Current scope:** the Writing module is fully implemented end to end.
Reading, Listening and Speaking are architectural placeholders (see the
`Module` enum in the Prisma schema).

---

## Tech stack

| Layer      | Technology                                   |
| ---------- | -------------------------------------------- |
| Framework  | Next.js 14 (App Router) + TypeScript         |
| Styling    | Tailwind CSS                                 |
| Database   | PostgreSQL + Prisma ORM (driver adapter/WASM)|
| AI         | Google Gemini API (swappable `AIGrader`)     |
| Validation | Zod                                          |
| i18n       | next-intl (uz default, ru)                   |
| Charts     | Recharts                                     |
| Auth       | Phone + password, JWT session cookie (jose)  |
| Tests      | Vitest (deterministic mocked AI provider)    |

---

## Project structure

```text
src/
├── app/
│   ├── page.tsx                    # Landing page
│   ├── login/  register/           # Auth pages
│   ├── dashboard/                  # Progress + history
│   ├── writing/                    # Essay editor
│   ├── writing/result/[id]/        # Result page
│   └── api/
│       ├── auth/                   # register, login, logout, me
│       ├── writing/                # submit, submissions, progress
│       └── locale/                 # language switcher
├── components/
│   ├── ui/  auth/  writing/  dashboard/  layout/
├── lib/
│   ├── ai/                         # ← ALL AI code lives here
│   │   ├── grading.ts              # provider factory (entry point)
│   │   ├── gemini.ts               # GeminiGrader: retries, backoff, timeout
│   │   ├── mock.ts                 # MockGrader (dev/test, deterministic)
│   │   ├── prompts.ts              # V1 (frozen) + V2 (calibrated) prompts
│   │   ├── schema.ts               # Zod contract + AIGrader interface
│   │   ├── result.ts               # single place: overall + meta assembly
│   │   ├── debug.ts                # dev-only diagnostics (hidden in prod)
│   │   ├── sanitize.ts             # secret scrubbing for logs/errors
│   │   └── json.ts                 # tolerant JSON extraction
│   ├── db/                         # Prisma client singleton
│   ├── auth/                       # session (JWT), password (bcrypt), sms
│   ├── payments/                   # Click/Payme abstraction (mock mode)
│   ├── writing/                    # grading pipeline service
│   ├── utils/                      # scoring, rate limit, api helpers
│   └── validations/                # Zod input schemas
├── i18n.ts                         # next-intl config (cookie-based locale)
└── middleware.ts                   # protects /dashboard, /writing
messages/                           # uz.json, ru.json
prisma/                             # schema + SQL migrations
scripts/
├── dev-db.mjs                      # embedded PostgreSQL for local dev
├── apply-migrations.mjs            # offline migration runner
├── prisma-generate.mjs             # offline-safe prisma generate
├── calibrate-writing.ts            # grader calibration CLI
└── calibration/essays.json         # synthetic calibration set
tests/                              # vitest suites
```

---

## Installation

Requirements: **Node.js 20+**, **PostgreSQL 14+** (or use the bundled dev DB).

```bash
git clone <repo-url>
cd IELTSbatter
npm install
cp .env.example .env       # then edit values
```

### Environment variables (`.env`)

| Variable                    | Description                                            |
| --------------------------- | ------------------------------------------------------ |
| `DATABASE_URL`              | PostgreSQL connection string                           |
| `SESSION_SECRET`            | 32+ random chars for signing session JWTs              |
| `AI_MODE`                   | `gemini` (real grading) or `mock` (no API calls)       |
| `GEMINI_API_KEY`            | Google AI Studio API key (server-side only)            |
| `GEMINI_MODEL`              | e.g. `gemini-1.5-flash` — never hardcoded              |
| `AI_PROMPT_VERSION`         | `V2` (calibrated, default) or `V1` (original)          |
| `GEMINI_MAX_ATTEMPTS`       | Retry budget per grading (default 3; 1 = no retry)     |
| `GEMINI_TIMEOUT_MS`         | Timeout for one Gemini request (default 60000)         |
| `GEMINI_RETRY_BASE_MS`      | Base delay for exponential backoff (default 800)       |
| `AI_DEBUG`                  | Dev-only diagnostics; **always off in production**     |
| `SMS_MODE`                  | `mock` (logs code to console) or `live`                |
| `PAYMENT_MODE`              | `mock`, `click`, or `payme`                            |
| `NEXT_PUBLIC_APP_URL`       | Public app URL                                         |
| `WRITING_MIN_WORDS`         | Recommended minimum words (default 250)                |
| `WRITING_ENFORCE_MIN_WORDS` | `true` to reject essays under the minimum              |

### Database

Option A — your own PostgreSQL: set `DATABASE_URL`, then:

```bash
npx prisma migrate deploy      # apply migrations
npx prisma generate            # generate client
```

Option B — bundled dev database (no system install needed):

```bash
npm run db:dev                 # starts embedded PostgreSQL on :5432 (keep running)
npm run db:migrate             # in another terminal
```

Offline/firewalled environments (Prisma CDN blocked):

```bash
npm run db:generate:offline    # generate client without downloading engines
npm run db:migrate:offline     # apply SQL migrations directly via pg
```

The Prisma client is generated with `engineType = "client"` (WASM query
compiler) + the `pg` driver adapter, so **no native engine binaries are needed
at runtime**.

### Gemini API setup

1. Create an API key at https://aistudio.google.com/apikey
2. In `.env`: `AI_MODE=gemini`, `GEMINI_API_KEY=...`, `GEMINI_MODEL=gemini-1.5-flash`
3. Restart the server. Without a key, keep `AI_MODE=mock` — the whole flow
   still works with deterministic demo grades.

The key is read only in `src/lib/ai/gemini.ts` (server-side). It is never sent
to the browser and never logged.

---

## Local development

```bash
npm run db:dev     # terminal 1 (if using bundled DB)
npm run dev        # terminal 2 → http://localhost:3000
```

## Tests

```bash
npm test
```

139 tests across 15 suites: grading schema validation, IELTS score rounding
incl. .25/.75 boundaries, input validation, retry/backoff/fail-fast behaviour
of the Gemini grader (injected transport — no network), invalid JSON / missing
field / invalid band / unsupported category handling, secret redaction, debug
gating, prompt version registry, calibration fixtures, submission creation,
prompt-version & token-usage persistence, warning calculation/persistence,
provider factory configuration, static security guards (no client-side provider
imports, no hardcoded keys, no raw SQL, `.env` ignored), and authorization
(users cannot read others' submissions). Tests never call the real Gemini API.

## Production build

```bash
npm run build
npm start
```

### Deployment notes

- Set all env vars from `.env.example` (strong `SESSION_SECRET`, real `DATABASE_URL`, `AI_MODE=gemini`).
- Run `npx prisma migrate deploy` on release.
- The in-memory rate limiter is per-instance; put Redis behind
  `src/lib/utils/rate-limit.ts` when scaling horizontally.
- SMS (`SMS_MODE=live`) and payments (`PAYMENT_MODE=click|payme`) need real
  provider implementations in `src/lib/auth/sms.ts` and `src/lib/payments/`.

---

## AI grader calibration

The writing grader can be run over a synthetic calibration set and compared
against human reference bands — this is how prompt V2 was validated and how V1
vs V2 will be compared on the same essays.

```bash
npm run calibrate                        # whole set, active AI_PROMPT_VERSION
npm run calibrate -- --compare           # V1 and V2 side by side, same essays
npm run calibrate -- --prompt V1
npm run calibrate -- --id strong --id weak
npm run calibrate -- --locale uz --delay 2000
npm run calibrate -- --out calibration-report.json
```

Output per essay:

```text
Task Response
Expected: 7.5
AI:       7.0  (-0.5)

Coherence & Cohesion
Expected: 7.5
AI:       7.5  (match)
...
Overall
Expected: 7.5
AI:       7.0  (-0.5)

meta: provider=gemini model=gemini-1.5-flash prompt=WRITING_GRADING_PROMPT_V2
      latency=8123ms attempts=1 retries=0 validation=VALID tokens=1620/498
```

plus a per-criterion accuracy table (mean absolute difference, exact matches and
signed bias — positive bias means the model scored above the reference), a
summary table with the overall numbers, and with `--compare` a V1-vs-V2 table
over the same essays including which prompt landed closer per essay.

The utility reuses the production prompt builders, Zod schema and scoring code,
so what you measure is exactly what users get. It never touches the database.
It reports measurements only — a prompt is not declared "better" by this script;
that requires a larger, independently scored sample.

The fixture set (`scripts/calibration/essays.json`) is synthetic and covers:
weak, average, strong, grammar-heavy, vocabulary-heavy, poor-task-response and
under-length essays. No real user data is used anywhere in it.

If `AI_MODE` is not `gemini` (or the API key is missing) the utility says so and
falls back to the deterministic MockGrader, so the pipeline can be checked
without an API key.

---

## Reliability, cost control and debugging

- **Bounded retries.** One HTTP call per attempt with a hard timeout
  (`GEMINI_TIMEOUT_MS`); retries use exponential backoff with jitter and stop at
  `GEMINI_MAX_ATTEMPTS`. There is no infinite retry.
- **Smart retry policy.** 429 / 5xx / timeouts / network errors and unusable
  model output (bad JSON, schema mismatch) are retried; configuration errors
  (400/401/403/404 — bad key or unknown model) fail immediately.
- **Never crashes.** If grading still fails, the submission becomes `FAILED`,
  the user gets a translatable `grading_failed` error, and the failure is stored
  in `AiEvaluation` (raw response, attempts, validation status) for debugging.
- **Raw responses are persisted** with `provider`, `model` and `promptVersion`,
  so V1 and V2 results can be compared later.
- **Cost control.** `inputTokens` / `outputTokens` / `latencyMs` are stored when
  the provider reports them and stay `NULL` otherwise.
- **Secrets never leak.** Provider errors are scrubbed of key material before
  logging or storage; the key itself is only read inside
  `src/lib/ai/gemini.ts` (server-side).
- **Operator warnings.** Each evaluation can carry non-fatal `warnings`
  (`AI_OVERALL_MISMATCH`, `RAW_RESPONSE_TRUNCATED`, `ESSAY_UNDER_MIN_WORDS`,
  `LOW_OUTPUT_TOKENS`). Provider-level warnings are reported by the AI layer,
  essay-level ones by the pipeline, so they behave identically for every
  provider. They never change the user's scores.
- **Dev diagnostics.** Outside production, grading logs one line with model,
  prompt version, processing time, attempts, validation status and token usage,
  and `POST /api/writing/submit` also returns a `debug` object. In production
  neither is ever emitted — the check is hardcoded in `lib/env.ts`, so even a
  copied `.env` with `AI_DEBUG=true` cannot turn it on.
- **Misconfiguration degrades safely.** If the provider cannot be constructed
  (e.g. `AI_MODE=gemini` without `GEMINI_API_KEY`), the submission is marked
  `FAILED` with an evaluator row explaining the cause — it never stays `PENDING`
  or crashes the request.

---

## Architecture decisions

- **AI provider isolation.** Everything AI lives in `src/lib/ai/`. The app
  only imports `getGrader()` from `lib/ai/grading.ts`, which returns an
  `AIGrader` implementation. Swapping Gemini for another model = one new file
  + one line in the factory.
- **Overall band is computed server-side** (`lib/utils/scoring.ts`) from the
  four criterion scores using official IELTS rounding (.25 → up, .75 → up).
  The AI's own "overall" is never trusted.
- **Strict JSON contract.** AI output is validated with Zod
  (`lib/ai/schema.ts`); malformed responses are retried, and persistent
  failure marks the submission `FAILED` instead of crashing.
- **Prompts are versioned, never edited in place.** `WRITING_GRADING_PROMPT_V1`
  is frozen; V2 (criterion checklists, anti-sycophancy/anti-inflation rules,
  independent per-criterion scoring first, de-duplicated errors) is the default.
  `AI_PROMPT_VERSION` selects the active one and every `AiEvaluation` row records
  which prompt produced it.
- **Raw AI responses are stored** in `AiEvaluation` (provider, model, prompt
  version, latency, attempts, retries, validation status, token usage) for
  debugging, cost tracking and future model comparison.
- **Future modules** (Reading/Listening/Speaking) hook into `Submission.module`.
- **Admin** is prepared via `User.role` (`USER`/`ADMIN`); a panel can be added
  without schema changes.

## What is currently mocked

| Area     | Status                                                        |
| -------- | ------------------------------------------------------------- |
| AI       | `AI_MODE=mock` returns deterministic demo grades; set a Gemini key for real grading |
| SMS      | `SMS_MODE=mock` logs verification codes to the server console |
| Payments | `PAYMENT_MODE=mock` marks payments paid instantly             |
