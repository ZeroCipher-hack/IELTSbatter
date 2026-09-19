# AXI — IELTS assessment platform

AXI is a web platform for IELTS candidates in Uzbekistan covering all four
skills. The **Writing** module grades an essay with an AI provider against the
official IELTS Writing Band Descriptors:

- **Task Response**
- **Coherence & Cohesion**
- **Lexical Resource**
- **Grammatical Range & Accuracy**

The platform returns per-criterion band scores, a server-computed overall band
(official IELTS rounding), concrete error corrections, detailed feedback, and
tracks progress over time.

**Reading** and **Listening** are graded deterministically against answer keys
stored in the database — no AI is involved anywhere in their scoring. They
share one engine (`src/lib/testing/`) and one set of UI components:

- test catalog, passage/audio stimulus, six extensible question types
  (multiple choice, true/false/not given, yes/no/not given, matching, sentence
  completion, short answer);
- countdown timer derived from the attempt's server-side start time, question
  navigator, progress indicator;
- autosave (so a refresh never loses answers), server-side submit, raw score,
  configurable raw→band conversion;
- result page with section breakdown, per-question-type analysis, strengths /
  weaknesses / recommendations (all derived from the stored outcome) and a
  mistake review showing the learner's answer, the correct answer and the
  explanation when the author provided one.

The **Listening** audio is served from a URL (`public/audio/…` in development,
object storage in production) — audio is never stored as binary in the
database.

**Speaking** implements the full IELTS structure (Parts 1–3) with preparation
and speaking timers, browser microphone recording, playback/re-record, upload
and an evaluation pipeline:

```
audio → transcription provider → transcript → speaking grader → structured JSON
      → database → result page
```

Both halves of the pipeline live behind `src/lib/ai/speaking/` (factory only;
`GeminiTranscriptionProvider`/`GeminiSpeakingGrader` for real use,
`MockTranscriptionProvider`/`MockSpeakingGrader` for development and tests).
Mock output is flagged `isMock` and is clearly labelled **MOCK** in the UI — it
is never presented as a real AI evaluation. The overall speaking band is
recomputed on the server from the four criteria.

The dashboard shows Writing, Reading, Listening and Speaking with the latest
band, the previous band, progress, attempt count and history — all read from
the database.

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
│   ├── writing/                    # writing grading pipeline service
│   ├── testing/                    # shared Reading/Listening engine
│   │   ├── types.ts                # question types, public (key-stripped) test
│   │   ├── scoring.ts              # answer normalisation + scoring
│   │   ├── band-conversion.ts      # raw → band tables (env-overridable)
│   │   ├── feedback.ts             # deterministic strengths/weaknesses
│   │   └── service.ts              # catalog, attempts, grading, progress
│   ├── speaking/                   # speaking pipeline service
│   │   ├── types.ts                # client-safe speaking types
│   │   └── service.ts              # submissions, uploads, evaluation
│   ├── ai/speaking/                # speaking AI providers (factory + providers)
│   ├── storage/                    # public/private file storage abstraction
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
├── seed-tests.ts                   # demo Reading/Listening/Speaking tests
├── e2e-smoke.mjs                   # full-journey E2E smoke test
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
| `BAND_TABLE_OVERRIDE`       | Optional JSON raw(40)→band tables for Reading/Listening|
| `SPEAKING_MAX_RECORDING_SECONDS` | Hard cap per speaking recording (default 300)     |
| `SPEAKING_MAX_UPLOAD_MB`    | Max upload size per recording (default 25)             |

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

### Demo data (Reading / Listening / Speaking)

```bash
npm run db:seed     # idempotent: creates the demo tests and sample audio
```

Creates one published test per objective/speaking module, including a generated
4-second placeholder WAV per listening section (documented as a placeholder,
not real exam audio) and a two-passage reading test covering every question
type. The seed is safe to re-run and deletes listening audio that no longer
belongs to a section.

## Modules and routes

| Module    | Runner                       | Result                        | Scoring |
| --------- | ---------------------------- | ----------------------------- | ------- |
| Writing   | `/writing`                   | `/writing/result/[id]`        | AI provider (server-side) |
| Reading   | `/reading/[testId]`          | `/reading/result/[attemptId]` | stored answer key, no AI |
| Listening | `/listening/[testId]`        | `/listening/result/[attemptId]` | stored answer key, no AI |
| Speaking  | `/speaking/[testId]`         | `/speaking/result/[submissionId]` | AI provider (transcript), mock in dev |

API surface (all require a session; ids are always owner-scoped):

```text
GET   /api/tests/[module]                     # published catalog (reading|listening)
GET   /api/tests/[module]/[testId]            # learner-safe test (answers stripped)
POST  /api/attempts                           # start an attempt
GET   /api/attempts                           # reading + listening progress
GET   /api/attempts/[id]                      # in-progress state of own attempt
PATCH /api/attempts/[id]                      # autosave answers
POST  /api/attempts/[id]/submit               # grade server-side
GET   /api/attempts/[id]/result               # result + review (owner only)
GET   /api/speaking/tests[?testId]            # speaking catalog / one test
POST  /api/speaking/submissions               # start a speaking attempt
GET   /api/speaking/submissions/[id]          # status + own result
POST  /api/speaking/submissions/[id]/audio    # upload the recording
POST  /api/speaking/submissions/[id]/evaluate # transcribe + evaluate
GET   /api/audio/[id]                         # stream a recording (owner only)
```

## Tests

```bash
npm test
```

266 tests across 26 suites: grading schema validation, IELTS score rounding
incl. .25/.75 boundaries, input validation, retry/backoff/fail-fast behaviour
of the Gemini grader (injected transport — no network), invalid JSON / missing
field / invalid band / unsupported category handling, secret redaction, debug
gating, prompt version registry, calibration fixtures, submission creation,
prompt-version & token-usage persistence, warning calculation/persistence,
provider factory configuration, the calibration report contract (MAD, bias,
exact matches, latency, retries, validation statuses), static security guards
(no client-side provider imports, no hardcoded keys, no raw SQL, `.env` ignored),
and authorization (users cannot read others' submissions).

Module coverage added with the Reading/Listening/Speaking work: the scoring and
band-conversion engine (all six question types, normalisation, /40 scaling,
custom band tables), the attempt lifecycle against a real database (autosave,
grading, immutability after submit, resume/abandon, ownership), the speaking
pipeline (private storage, mock transcription, mock evaluation, failure paths,
ownership), the speaking AI layer (schema, retry/backoff, fail-fast on 401,
no-key-leak assertions, factory fallback) and static guards for the new routes
(answer keys never leave the server, audio ownership checks, no storage keys in
responses, no secrets outside `lib/env.ts`).

Tests never call the real Gemini API.

## End-to-end smoke test

```bash
npm run build && npm start     # terminal 1
npm run e2e                    # terminal 2 (BASE_URL defaults to :3000)
```

Walks the whole learner journey over HTTP — register → login → dashboard →
writing → idempotent retry → result → reading → submit → result → listening → submit →
result → speaking Part 1/2/3 transitions → refresh recovery → duplicate upload →
mock transcription → mock evaluation → result → dashboard → history — asserting
the HTTP status, the stored database state and
the rendered UI at every step. It also verifies anonymous access is rejected
(401), another user's result/submission/recording is unreachable (404), late
answer writes are refused (409), mock results are labelled MOCK, and no API key
or env secret appears in any response. With `AI_MODE=mock` no external AI
provider is contacted.

## Production build

```bash
npm run build
npm start
```

### Deployment notes

- Set all env vars from `.env.example` (strong `SESSION_SECRET`, real `DATABASE_URL`, `AI_MODE=gemini`).
- Run `npx prisma migrate deploy` on release.
- Run `npm run db:seed`, start the built server with `AI_MODE=mock`, then run
  `npm run e2e` against a disposable staging database before promotion.
- The in-memory rate limiter is per-instance; put Redis behind
  `src/lib/utils/rate-limit.ts` when scaling horizontally.
- SMS (`SMS_MODE=live`) and payments (`PAYMENT_MODE=click|payme`) need real
  provider implementations in `src/lib/auth/sms.ts` and `src/lib/payments/`.
- Speaking recordings are written to `var/uploads/` (git-ignored) by the default
  storage provider; swap `src/lib/storage/index.ts` for S3-style storage without
  touching the services. Published listening audio lives under `public/audio/`
  and is regenerated by `npm run db:seed`.
- Set `AI_MODE=gemini` (with `GEMINI_API_KEY` in the environment) to switch the
  Writing and Speaking pipelines from the mock providers to Gemini. Until then
  every AI-produced result is labelled MOCK in the UI.

---

## AI grader calibration

The writing grader can be run over a synthetic calibration set and compared
against human reference bands — this is how prompt V2 was validated and how V1
vs V2 will be compared on the same essays.

```bash
# Real calibration (requires AI_MODE=gemini + GEMINI_API_KEY):
npm run calibrate -- --compare --out report.json   # V1 and V2 over the same essays
npm run calibrate -- --prompt V1
npm run calibrate -- --prompt V2
npm run calibrate -- --id strong --id weak
npm run calibrate -- --locale uz --delay 2000

# Pipeline smoke test without a key (mock grades — NOT a calibration):
npm run calibrate -- --allow-mock
```

Without a configured Gemini key the script **aborts with exit code 2** instead of
producing numbers that look real. Mock runs must be requested explicitly with
`--allow-mock` and are banner-flagged in the console and in the JSON report
(`"mock": true`, `"warning": ...`).

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

Each essay block prints Expected / AI / **Abs diff** for all four criteria and
the overall band, plus provider, model, prompt version, latency, attempts,
retries, validation status and token usage.

The report file (`--out`) additionally contains, per prompt version:
`summary` with overall MAD, mean signed bias, exact-match count, mean latency,
total retries, failed runs, validation-status counts and a per-criterion
`criteria[]` breakdown, plus every run with `expected`, `actual`, `absDiff`,
`signedDiff` and `meta`. Console output adds a per-criterion accuracy table
(mean absolute difference, exact matches, signed bias — positive bias means the
model scored above the reference) and, with `--compare`, a V1-vs-V2 table over
the same essays including which prompt landed closer per essay.

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
