#!/usr/bin/env node
/**
 * AXI — Writing grader calibration utility.
 *
 * Runs the configured AI grader over the synthetic calibration set and prints
 * an expected-vs-AI comparison for every criterion plus the overall band, the
 * per-criterion mean absolute difference, and (with --compare) a V1-vs-V2
 * side-by-side table over the same essays.
 *
 * Usage:
 *   npm run calibrate
 *   npm run calibrate -- --compare
 *   npm run calibrate -- --prompt V1
 *   npm run calibrate -- --id weak --id strong
 *   npm run calibrate -- --model gemini-1.5-pro --locale ru
 *   npm run calibrate -- --file scripts/calibration/my-essays.json --out report.json
 *
 * Notes:
 *  - Uses the SAME prompt builders / schema / scoring code as production, so a
 *    calibration run measures exactly what users get.
 *  - Reference ("expected") scores come from the fixture file and are optional;
 *    without them the script still prints the AI output.
 *  - Never writes to the database, never uses real user data, and never prints
 *    the API key.
 *  - Results are measurements only: the script never declares a prompt "good".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeOverall, countWords, type CriterionScores } from "../src/lib/utils/scoring";
import { buildWritingGradingPromptForVersion, promptVersionFromLabel } from "../src/lib/ai/prompts";
import { GeminiGrader, AIGradingError } from "../src/lib/ai/gemini";
import { MockGrader } from "../src/lib/ai/mock";
import type { AIGrader, ValidationStatus } from "../src/lib/ai/schema";
import type { WritingPromptVersion } from "../src/lib/ai/prompts";

// ---------------------------------------------------------------- env / args

try {
  // Node >= 20.12: load .env so GEMINI_API_KEY / GEMINI_MODEL work as usual.
  process.loadEnvFile?.(".env");
} catch {
  /* no .env file — rely on the real environment */
}

interface CliArgs {
  ids: string[];
  file: string;
  prompt: WritingPromptVersion;
  compare: boolean;
  allowMock: boolean;
  locale: string;
  model?: string;
  out?: string;
  delayMs: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    ids: [],
    file: path.join("scripts", "calibration", "essays.json"),
    prompt: promptVersionFromLabel(process.env.AI_PROMPT_VERSION ?? "V2"),
    compare: false,
    allowMock: false,
    locale: "en",
    delayMs: 1500,
  };

  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const next = () => inline ?? argv[++i];
    switch (flag) {
      case "--id":
        args.ids.push(next());
        break;
      case "--file":
        args.file = next();
        break;
      case "--prompt":
        args.prompt = promptVersionFromLabel(next());
        break;
      case "--compare":
        args.compare = true;
        break;
      case "--allow-mock":
        args.allowMock = true;
        break;
      case "--locale":
        args.locale = next();
        break;
      case "--model":
        args.model = next();
        break;
      case "--out":
        args.out = next();
        break;
      case "--delay":
        args.delayMs = Number(next());
        break;
      case "--help":
      case "-h":
        console.log(HELP);
        process.exit(0);
      default:
        console.error(`Unknown option: ${argv[i]}\n\n${HELP}`);
        process.exit(2);
    }
  }
  return args;
}

const HELP = `AXI writing grader calibration

Options:
  --id <fixtureId>      run only the given essay (repeatable)
  --file <path>         fixture file (default: scripts/calibration/essays.json)
  --prompt <V1|V2>      prompt version to test (default: AI_PROMPT_VERSION or V2)
  --compare             run BOTH V1 and V2 over the same essays (2x API calls)
  --allow-mock          run the MockGrader on purpose (NOT a real calibration)
  --locale <uz|ru|en>   feedback language sent to the model (default: en)
  --model <name>        override GEMINI_MODEL for this run
  --delay <ms>          pause between essays to respect API rate limits (default: 1500)
  --out <path>          write a JSON report of the run
`;

// ------------------------------------------------------------------ fixtures

interface FixtureEssay {
  id: string;
  label?: string;
  essay: string;
  expected?: CriterionScores;
}

interface FixtureFile {
  question: string;
  essays: FixtureEssay[];
}

function loadFixtures(file: string): FixtureFile {
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.error(`Fixture file not found: ${abs}`);
    process.exit(2);
  }
  const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as FixtureFile;
  if (!parsed.question || !Array.isArray(parsed.essays) || parsed.essays.length === 0) {
    console.error("Fixture file must contain { question, essays: [...] }");
    process.exit(2);
  }
  return parsed;
}

// -------------------------------------------------------------------- grader

function createGrader(args: CliArgs, promptVersion: WritingPromptVersion, useMock: boolean): AIGrader {
  if (useMock) return new MockGrader(promptVersion);
  return new GeminiGrader({ promptVersion, model: args.model });
}

// --------------------------------------------------------------------- output

const CRITERIA: Array<{ key: keyof CriterionScores; title: string }> = [
  { key: "taskResponse", title: "Task Response" },
  { key: "coherenceCohesion", title: "Coherence & Cohesion" },
  { key: "lexicalResource", title: "Lexical Resource" },
  { key: "grammar", title: "Grammar" },
];

function band(value: number | undefined): string {
  return value == null ? "n/a" : value.toFixed(1);
}

function delta(actual: number, expected: number | undefined): string {
  if (expected == null) return "";
  const d = actual - expected;
  if (d === 0) return "  (match)";
  const sign = d > 0 ? "+" : "";
  return `  (${sign}${d.toFixed(1)})`;
}

interface RunMeta {
  provider: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  attempts: number;
  retryCount: number;
  validationStatus: ValidationStatus;
  validationErrors: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  warnings: string[];
}

export interface RunResult {
  id: string;
  label?: string;
  words: number;
  ok: boolean;
  expected?: CriterionScores;
  expectedOverall?: number;
  actual?: CriterionScores & { overall: number };
  /** Absolute |AI - expected| per criterion (undefined without a reference). */
  absDiff?: Record<keyof CriterionScores | "overall", number | null>;
  /** Signed AI - expected per criterion (positive = model scored higher). */
  signedDiff?: Record<keyof CriterionScores | "overall", number | null>;
  meta?: RunMeta;
  error?: string;
}

/** Run one grader over one essay and normalize the outcome for reporting. */
async function runOne(
  grader: AIGrader,
  fixture: FixtureEssay,
  question: string,
  locale: string
): Promise<RunResult> {
  const base = {
    id: fixture.id,
    label: fixture.label,
    words: countWords(fixture.essay),
    expected: fixture.expected,
    expectedOverall: fixture.expected ? computeOverall(fixture.expected) : undefined,
  };

  try {
    const result = await grader.gradeWriting({
      question,
      essay: fixture.essay,
      feedbackLocale: locale,
    });
    const actual: CriterionScores & { overall: number } = {
      taskResponse: result.data.scores.taskResponse.band,
      coherenceCohesion: result.data.scores.coherenceCohesion.band,
      lexicalResource: result.data.scores.lexicalResource.band,
      grammar: result.data.scores.grammar.band,
      overall: result.overall,
    };

    const expectedValues: Array<keyof CriterionScores | "overall"> = [
      "taskResponse",
      "coherenceCohesion",
      "lexicalResource",
      "grammar",
      "overall",
    ];
    const absDiff = {} as Record<keyof CriterionScores | "overall", number | null>;
    const signedDiff = {} as Record<keyof CriterionScores | "overall", number | null>;
    for (const key of expectedValues) {
      const expected = key === "overall" ? base.expectedOverall : base.expected?.[key];
      if (expected == null) {
        absDiff[key] = null;
        signedDiff[key] = null;
        continue;
      }
      absDiff[key] = Number(Math.abs(actual[key] - expected).toFixed(2));
      signedDiff[key] = Number((actual[key] - expected).toFixed(2));
    }

    return {
      ...base,
      ok: true,
      actual,
      absDiff,
      signedDiff,
      meta: {
        provider: result.meta.provider,
        model: result.meta.model,
        promptVersion: result.meta.promptVersion,
        latencyMs: result.meta.latencyMs,
        attempts: result.meta.attempts,
        retryCount: result.meta.retryCount,
        validationStatus: result.meta.validationStatus,
        validationErrors: result.meta.validationErrors,
        inputTokens: result.meta.inputTokens,
        outputTokens: result.meta.outputTokens,
        warnings: result.meta.warnings,
      },
    };
  } catch (error) {
    const details = error instanceof AIGradingError ? error.details : undefined;
    return {
      ...base,
      ok: false,
      error: details ? details.reason : error instanceof Error ? error.message : String(error),
      meta: details
        ? {
            provider: details.provider,
            model: details.model,
            promptVersion: details.promptVersion,
            latencyMs: details.latencyMs,
            attempts: details.attempts,
            retryCount: details.retryCount,
            validationStatus: details.validationStatus,
            validationErrors: details.validationErrors,
            inputTokens: null,
            outputTokens: null,
            warnings: [],
          }
        : undefined,
    };
  }
}

function printComparison(result: RunResult): void {
  console.log("");
  console.log("─".repeat(58));
  console.log(`Essay: ${result.id}${result.label ? ` — ${result.label}` : ""}`);
  console.log(`Words: ${result.words}`);
  console.log("─".repeat(58));

  if (!result.ok || !result.actual) {
    console.log(`FAILED: ${result.error ?? "unknown error"}`);
    if (result.meta) {
      console.log(
        `meta: provider=${result.meta.provider} model=${result.meta.model} ` +
          `prompt=${result.meta.promptVersion} attempts=${result.meta.attempts} ` +
          `validation=${result.meta.validationStatus}`
      );
      if (result.meta.validationErrors.length) {
        console.log(`validation errors: ${result.meta.validationErrors.join(" | ")}`);
      }
    }
    return;
  }

  for (const { key, title } of CRITERIA) {
    const expected = result.expected?.[key];
    const actual = result.actual[key];
    const abs = result.absDiff?.[key];
    console.log("");
    console.log(title);
    console.log(`Expected: ${band(expected)}`);
    console.log(`AI:       ${band(actual)}${delta(actual, expected)}`);
    console.log(`Abs diff: ${abs == null ? "n/a" : abs.toFixed(1)}`);
  }

  console.log("");
  console.log("Overall");
  console.log(`Expected: ${band(result.expectedOverall)}`);
  console.log(`AI:       ${band(result.actual.overall)}${delta(result.actual.overall, result.expectedOverall)}`);
  console.log(`Abs diff: ${result.absDiff?.overall == null ? "n/a" : result.absDiff.overall.toFixed(1)}`);

  if (result.meta) {
    console.log("");
    console.log(
      `meta: provider=${result.meta.provider} model=${result.meta.model} prompt=${result.meta.promptVersion}`
    );
    console.log(
      `      latency=${result.meta.latencyMs}ms attempts=${result.meta.attempts} ` +
        `retries=${result.meta.retryCount} validation=${result.meta.validationStatus} ` +
        `tokens=${result.meta.inputTokens ?? "-"}/${result.meta.outputTokens ?? "-"}`
    );
    if (result.meta.warnings.length) {
      console.log(`      warnings=${result.meta.warnings.join(",")}`);
    }
  }
}

export interface PromptSummary {
  promptVersion: string;
  model: string | null;
  mock: boolean;
  n: number;
  overallMeanAbsDiff: number | null;
  overallMeanSignedBias: number | null;
  overallExact: number;
  meanLatencyMs: number | null;
  totalRetries: number;
  failedRuns: number;
  validationStatuses: Record<string, number>;
  criteria: Array<{ criterion: string; meanAbsDiff: number | null; meanSignedBias: number | null; exact: number; n: number }>;
}

export function summarize(promptVersion: string, results: RunResult[], mock: boolean): PromptSummary {
  const accuracy = accuracyFor(results);
  const overall = accuracy.find((a) => a.key === "Overall");
  const withMeta = results.filter((r) => r.meta);
  // Only validation statuses are counted here; failures have their own field.
  const statuses: Record<string, number> = {};
  for (const r of results) {
    const status = r.meta?.validationStatus ?? (r.ok ? "VALID" : "UNKNOWN");
    statuses[status] = (statuses[status] ?? 0) + 1;
  }

  return {
    promptVersion,
    model: withMeta[0]?.meta?.model ?? null,
    mock,
    n: overall?.n ?? 0,
    overallMeanAbsDiff: overall && !Number.isNaN(overall.meanAbsDiff) ? Number(overall.meanAbsDiff.toFixed(3)) : null,
    overallMeanSignedBias: overall && !Number.isNaN(overall.bias) ? Number(overall.bias.toFixed(3)) : null,
    overallExact: overall?.exact ?? 0,
    meanLatencyMs: withMeta.length
      ? Math.round(withMeta.reduce((sum, r) => sum + r.meta!.latencyMs, 0) / withMeta.length)
      : null,
    totalRetries: withMeta.reduce((sum, r) => sum + r.meta!.retryCount, 0),
    failedRuns: results.filter((r) => !r.ok).length,
    validationStatuses: statuses,
    criteria: accuracy.map((a) => ({
      criterion: a.key,
      meanAbsDiff: Number.isNaN(a.meanAbsDiff) ? null : Number(a.meanAbsDiff.toFixed(3)),
      meanSignedBias: Number.isNaN(a.bias) ? null : Number(a.bias.toFixed(3)),
      exact: a.exact,
      n: a.n,
    })),
  };
}

export interface Accuracy {
  key: string;
  meanAbsDiff: number;
  exact: number;
  n: number;
  bias: number;
}

/** Mean absolute difference / exact matches / signed bias per criterion. */
export function accuracyFor(results: RunResult[]): Accuracy[] {
  const scored = results.filter((r) => r.ok && r.actual && r.expected);
  const n = scored.length;

  const pick = (r: RunResult, key: "overall" | keyof CriterionScores): number =>
    key === "overall" ? r.actual!.overall : r.actual![key];
  const exp = (r: RunResult, key: "overall" | keyof CriterionScores): number =>
    key === "overall" ? r.expectedOverall! : r.expected![key];

  const rows: Accuracy[] = [
    ...CRITERIA.map((c) => ({ key: c.title, k: c.key })),
    { key: "Overall", k: "overall" as const },
  ].map(({ key, k }) => ({
    key,
    n,
    meanAbsDiff: n
      ? scored.reduce((sum, r) => sum + Math.abs(pick(r, k) - exp(r, k)), 0) / n
      : NaN,
    exact: scored.filter((r) => pick(r, k) === exp(r, k)).length,
    bias: n ? scored.reduce((sum, r) => sum + (pick(r, k) - exp(r, k)), 0) / n : NaN,
  }));

  return rows;
}

function printAccuracy(results: RunResult[]): void {
  const rows = accuracyFor(results);
  if (!rows.length || Number.isNaN(rows[0].meanAbsDiff)) {
    console.log("\n(no reference scores in this selection — accuracy metrics skipped)");
    return;
  }

  console.log("\n=== ACCURACY vs reference (measured, not a pass/fail verdict) ===");
  console.table(
    rows.map((r) => ({
      Criterion: r.key,
      "MeanAbsDiff": r.meanAbsDiff.toFixed(2),
      "Exact": `${r.exact}/${r.n}`,
      "MeanSignedBias": (r.bias > 0 ? "+" : "") + r.bias.toFixed(2),
    }))
  );
  console.log(
    "MeanSignedBias > 0 means the model scored higher than the reference on average; < 0 means lower."
  );
}

function printSummaryTable(results: RunResult[]): void {
  const rows = results.map((r) => {
    const expected = r.expectedOverall;
    const actual = r.actual?.overall;
    const d = expected != null && actual != null ? actual - expected : undefined;
    return {
      Essay: r.id,
      "Exp.": band(expected),
      AI: band(actual),
      Delta: d == null ? "n/a" : `${d > 0 ? "+" : ""}${d.toFixed(1)}`,
      Attempts: r.meta ? String(r.meta.attempts) : "-",
      Status: r.ok ? "ok" : "FAILED",
    };
  });

  console.log("\n\n=== SUMMARY ===");
  console.table(rows);

  const withExpected = results.filter((r) => r.expectedOverall != null && r.actual);
  if (withExpected.length) {
    const meanAbs =
      withExpected.reduce((sum, r) => sum + Math.abs(r.actual!.overall - r.expectedOverall!), 0) /
      withExpected.length;
    const exact = withExpected.filter((r) => r.actual!.overall === r.expectedOverall).length;
    console.log(
      `Overall: mean absolute difference = ${meanAbs.toFixed(2)} band, ` +
        `exact matches = ${exact}/${withExpected.length}`
    );
  }
  printAccuracy(results);
}

/** V1 vs V2 side-by-side over the same essays. */
function printPromptComparison(v1: RunResult[], v2: RunResult[]): void {
  const rows = v1.map((a, i) => {
    const b = v2[i];
    const exp = a.expectedOverall;
    const d1 = a.actual && exp != null ? a.actual.overall - exp : undefined;
    const d2 = b?.actual && exp != null ? b.actual.overall - exp : undefined;
    return {
      Essay: a.id,
      Ref: band(exp),
      V1: band(a.actual?.overall),
      "V1 Δ": d1 == null ? "n/a" : `${d1 > 0 ? "+" : ""}${d1.toFixed(1)}`,
      V2: band(b?.actual?.overall),
      "V2 Δ": d2 == null ? "n/a" : `${d2 > 0 ? "+" : ""}${d2.toFixed(1)}`,
      Closer: d1 == null || d2 == null ? "n/a" : Math.abs(d1) === Math.abs(d2) ? "tie" : Math.abs(d1) < Math.abs(d2) ? "V1" : "V2",
      "V1 att.": a.meta ? String(a.meta.attempts) : "-",
      "V2 att.": b?.meta ? String(b.meta.attempts) : "-",
    };
  });

  console.log("\n\n=== V1 vs V2 (same essays, same model) ===");
  console.table(rows);

  for (const [label, results] of [
    ["V1", v1],
    ["V2", v2],
  ] as const) {
    const summary = summarize(label, results, false);
    if (!summary.n) {
      console.log(`${label}: no scored runs (${summary.failedRuns} failed)`);
      continue;
    }
    console.log(
      `${label}: MAD=${summary.overallMeanAbsDiff?.toFixed(2)} band, ` +
        `bias=${summary.overallMeanSignedBias && summary.overallMeanSignedBias > 0 ? "+" : ""}` +
        `${summary.overallMeanSignedBias?.toFixed(2)}, ` +
        `exact=${summary.overallExact}/${summary.n}, meanLatency=${summary.meanLatencyMs}ms, ` +
        `retries=${summary.totalRetries}, failed=${summary.failedRuns}`
    );
  }
  console.log(
    "Reporting only: these are measurements on this sample. A prompt is not \"better\" until a larger,\n" +
      "independently scored essay set says so."
  );
}

// ----------------------------------------------------------------------- main

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = loadFixtures(args.file);
  const essays = args.ids.length
    ? fixtures.essays.filter((e) => args.ids.includes(e.id))
    : fixtures.essays;

  if (essays.length === 0) {
    console.error(`No essays matched ids: ${args.ids.join(", ")}`);
    process.exit(2);
  }

  // Calibration is meaningless against the MockGrader, so real Gemini is the
  // default requirement. Mock output must be requested explicitly and is
  // clearly marked in both the console and the JSON report.
  const aiMode = process.env.AI_MODE ?? (process.env.GEMINI_API_KEY ? "gemini" : "mock");
  const useMock = aiMode !== "gemini";

  if (useMock && !args.allowMock) {
    console.error(
      "\nCALIBRATION ABORTED — real Gemini is not configured.\n" +
        `  AI_MODE            = ${process.env.AI_MODE ?? "(unset)"}\n` +
        `  GEMINI_API_KEY     = ${process.env.GEMINI_API_KEY ? "set" : "MISSING"}\n` +
        `  GEMINI_MODEL       = ${process.env.GEMINI_MODEL ?? "(unset)"}\n\n` +
        "  Set AI_MODE=gemini, GEMINI_API_KEY and GEMINI_MODEL in .env, then re-run:\n" +
        "    npm run calibrate -- --compare --out report.json\n\n" +
        "  To exercise the pipeline without a key (mock grades, NOT a real\n" +
        "  calibration — numbers say nothing about Gemini quality):\n" +
        "    npm run calibrate -- --allow-mock\n"
    );
    process.exit(2);
  }

  if (aiMode === "gemini" && !process.env.GEMINI_API_KEY) {
    console.error(
      "\nCALIBRATION ABORTED — AI_MODE=gemini but GEMINI_API_KEY is empty.\n" +
        "  Add the key to .env (never commit it) and re-run.\n"
    );
    process.exit(2);
  }

  const promptsToRun: WritingPromptVersion[] = args.compare
    ? ["WRITING_GRADING_PROMPT_V1", "WRITING_GRADING_PROMPT_V2"]
    : [args.prompt];

  console.log("AXI writing grader calibration");
  console.log(`  file          : ${args.file}`);
  console.log(`  essays        : ${essays.map((e) => e.id).join(", ")}`);
  console.log(`  prompt(s)     : ${promptsToRun.join(", ")}${args.compare ? " (compare mode — 2x calls)" : ""}`);
  console.log(`  feedback lang : ${args.locale}`);
  console.log(`  provider      : ${useMock ? "mock" : "gemini"}`);
  console.log(`  model         : ${useMock ? "mock-grader-1" : (args.model ?? process.env.GEMINI_MODEL ?? "?")}`);

  if (useMock) {
    console.log(
      "\n  " + "!".repeat(66) + "\n" +
        "  WARNING: MockGrader in use (--allow-mock). These numbers describe the\n" +
        "  deterministic mock, NOT Gemini. Do not treat them as calibration data.\n" +
        "  " + "!".repeat(66)
    );
  }

  const promptChars = buildWritingGradingPromptForVersion(promptsToRun[0], {
    question: fixtures.question,
    essay: essays[0].essay,
    feedbackLocale: args.locale,
  }).length;
  console.log(`  prompt chars  : ${promptChars}`);

  const byPrompt: Record<string, RunResult[]> = {};
  let callIndex = 0;

  for (const promptVersion of promptsToRun) {
    const grader = createGrader(args, promptVersion, useMock);
    const results: RunResult[] = [];

    for (const fixture of essays) {
      if (!fixture.expected) {
        console.log(`\n[${fixture.id}] no reference score — printing AI output only`);
      }
      if (callIndex > 0 && args.delayMs > 0) await sleep(args.delayMs);

      const result = await runOne(grader, fixture, fixtures.question, args.locale);
      results.push(result);
      callIndex++;

      if (!args.compare) printComparison(result);
    }

    byPrompt[promptVersion] = results;

    if (results.some((r) => r.meta)) {
      console.log(`\n[${promptVersion}] model=${results.find((r) => r.meta)?.meta?.model}`);
    }
  }

  if (args.compare) {
    printPromptComparison(
      byPrompt["WRITING_GRADING_PROMPT_V1"] ?? [],
      byPrompt["WRITING_GRADING_PROMPT_V2"] ?? []
    );
  } else {
    printSummaryTable(byPrompt[promptsToRun[0]]);
  }

  if (args.out) {
    const report = {
      generatedAt: new Date().toISOString(),
      provider: useMock ? "mock" : "gemini",
      model: Object.values(byPrompt)
        .flat()
        .find((r) => r.meta)?.meta?.model,
      mock: useMock,
      warning: useMock
        ? "MockGrader run (--allow-mock): these numbers describe the deterministic mock, not Gemini."
        : null,
      locale: args.locale,
      question: fixtures.question,
      essays: essays.length,
      runs: Object.entries(byPrompt).map(([promptVersion, results]) => ({
        promptVersion,
        summary: summarize(promptVersion, results, useMock),
        results,
      })),
    };
    const outPath = path.resolve(process.cwd(), args.out);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${outPath}`);
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
