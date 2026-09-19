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
│   │   ├── gemini.ts               # GeminiGrader (implements AIGrader)
│   │   ├── mock.ts                 # MockGrader (dev/test, deterministic)
│   │   ├── prompts.ts              # versioned prompts (WRITING_GRADING_PROMPT_V1)
│   │   ├── schema.ts               # Zod contract + AIGrader interface
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
scripts/                            # dev DB, offline migrate/generate helpers
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

Covers: grading schema validation, IELTS score rounding, input validation,
mocked-AI grading pipeline, invalid-AI-response handling, submission creation,
and authorization (users cannot read others' submissions). Tests never call
the real Gemini API.

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
- **Raw AI responses are stored** in `AiEvaluation` (provider, model, prompt
  version, latency) for debugging and future model comparison.
- **Future modules** (Reading/Listening/Speaking) hook into `Submission.module`.
- **Admin** is prepared via `User.role` (`USER`/`ADMIN`); a panel can be added
  without schema changes.

## What is currently mocked

| Area     | Status                                                        |
| -------- | ------------------------------------------------------------- |
| AI       | `AI_MODE=mock` returns deterministic demo grades; set a Gemini key for real grading |
| SMS      | `SMS_MODE=mock` logs verification codes to the server console |
| Payments | `PAYMENT_MODE=mock` marks payments paid instantly             |
