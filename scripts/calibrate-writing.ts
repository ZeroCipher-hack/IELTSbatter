#!/usr/bin/env node
/**
 * AXI — Writing grader calibration utility.
 *
 * Runs the configured AI grader over the synthetic calibration set and prints
 * an expected-vs-AI comparison for every criterion plus the overall band.
 *
 * Usage:
 *   npm run calibrate
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
 *  - Never writes to the database and never uses real user data.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeOverall, countWords } from "../src/lib/utils/scoring";
import { buildWritingGradingPromptForVersion, promptVersionFromLabel } from "../src/lib/ai/prompts";
import { GeminiGrader, AIGradingError } from "../src/lib/ai/gemini";
import { MockGrader } from "../src/lib/ai/mock";
import { writingGradingResponseSchema, type AIGrader, type ValidationStatus } from "../src/lib/ai/schema";
import type { WritingPromptVersion } from "../src/lib/ai/prompts";
import type { CriterionScores } from "../src/lib/utils/scoring";

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

function createGrader(args: CliArgs, useMock: boolean): AIGrader {
  if (useMock) return new MockGrader(args.prompt);
  return new GeminiGrader({ promptVersion: args.prompt, model: args.model });
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

interface RunResult {
  id: string;
  label?: string;
  words: number;
  ok: boolean;
  expected?: CriterionScores;
  expectedOverall?: number;
  actual?: CriterionScores & { overall: number };
  meta?: {
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
  };
  error?: string;
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
    console.log("");
    console.log(title);
    console.log(`Expected: ${band(expected)}`);
    console.log(`AI:       ${band(actual)}${delta(actual, expected)}`);
  }

  console.log("");
  console.log("Overall");
  console.log(`Expected: ${band(result.expectedOverall)}`);
  console.log(`AI:       ${band(result.actual.overall)}${delta(result.actual.overall, result.expectedOverall)}`);

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
  }
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
}

// ----------------------------------------------------------------------- main

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

  const useMock = (process.env.AI_MODE ?? (process.env.GEMINI_API_KEY ? "gemini" : "mock")) !== "gemini";
  const grader = createGrader(args, useMock);

  console.log("AXI writing grader calibration");
  console.log(`  file          : ${args.file}`);
  console.log(`  essays        : ${essays.map((e) => e.id).join(", ")}`);
  console.log(`  prompt version: ${args.prompt}`);
  console.log(`  feedback lang : ${args.locale}`);
  console.log(`  provider      : ${grader.provider} (model: ${grader.model})`);
  if (useMock) {
    console.log(
      "\n  NOTE: AI_MODE is not \"gemini\" (or GEMINI_API_KEY is missing) — running the\n" +
        "        deterministic MockGrader. Set AI_MODE=gemini and GEMINI_API_KEY in .env\n" +
        "        to calibrate against the real model."
    );
  }
  if (process.env.GEMINI_API_KEY && useMock) {
    console.log("  NOTE: a GEMINI_API_KEY exists but AI_MODE is not set to gemini.");
  }

  // Sanity check: the prompt for the selected version must build.
  const samplePrompt = buildWritingGradingPromptForVersion(args.prompt, {
    question: fixtures.question,
    essay: essays[0].essay,
    feedbackLocale: args.locale,
  });
  console.log(`  prompt chars  : ${samplePrompt.length}`);

  const results: RunResult[] = [];

  for (const fixture of essays) {
    if (!fixture.expected) {
      console.log(`\n[${fixture.id}] no reference score — printing AI output only`);
    }
    try {
      const result = await grader.gradeWriting({
        question: fixtures.question,
        essay: fixture.essay,
        feedbackLocale: args.locale,
      });
      results.push({
        id: fixture.id,
        label: fixture.label,
        words: countWords(fixture.essay),
        ok: true,
        expected: fixture.expected,
        expectedOverall: fixture.expected ? computeOverall(fixture.expected) : undefined,
        actual: {
          taskResponse: result.data.scores.taskResponse.band,
          coherenceCohesion: result.data.scores.coherenceCohesion.band,
          lexicalResource: result.data.scores.lexicalResource.band,
          grammar: result.data.scores.grammar.band,
          overall: result.overall,
        },
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
        },
      });
    } catch (error) {
      const details = error instanceof AIGradingError ? error.details : undefined;
      results.push({
        id: fixture.id,
        label: fixture.label,
        words: countWords(fixture.essay),
        ok: false,
        expected: fixture.expected,
        expectedOverall: fixture.expected ? computeOverall(fixture.expected) : undefined,
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
            }
          : undefined,
      });
    }

    printComparison(results[results.length - 1]);
    if (args.delayMs > 0 && essays.length > 1) {
      await new Promise((r) => setTimeout(r, args.delayMs));
    }
  }

  printSummaryTable(results);

  // Self-check on the code path the app uses (guards against schema drift).
  const schemaOk = results.every((r) => !r.actual || writingGradingResponseSchema.safeParse({
    scores: {
      taskResponse: { band: r.actual.taskResponse, note: "-" },
      coherenceCohesion: { band: r.actual.coherenceCohesion, note: "-" },
      lexicalResource: { band: r.actual.lexicalResource, note: "-" },
      grammar: { band: r.actual.grammar, note: "-" },
    },
    summary: "-",
    strengths: ["-"],
    weaknesses: ["-"],
    improvements: ["-"],
    errors: [],
  }).success);
  if (!schemaOk) {
    console.error("WARNING: an AI band was not schema-valid — investigate immediately.");
  }

  if (args.out) {
    const report = {
      generatedAt: new Date().toISOString(),
      promptVersion: args.prompt,
      provider: grader.provider,
      model: grader.model,
      mock: useMock,
      locale: args.locale,
      question: fixtures.question,
      results,
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
