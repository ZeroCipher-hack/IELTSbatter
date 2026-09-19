/**
 * The calibration set is test data — it must stay synthetic, well-formed and
 * covered by the same validation the app applies to real submissions.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { bandScoreSchema, ERROR_CATEGORIES } from "@/lib/ai/schema";
import { writingSubmissionSchema } from "@/lib/validations/writing";
import { computeOverall, countWords } from "@/lib/utils/scoring";

interface Fixture {
  id: string;
  label?: string;
  essay: string;
  expected?: {
    taskResponse: number;
    coherenceCohesion: number;
    lexicalResource: number;
    grammar: number;
  };
}

const file = path.join(process.cwd(), "scripts", "calibration", "essays.json");
const fixtures = JSON.parse(fs.readFileSync(file, "utf8")) as {
  question: string;
  essays: Fixture[];
};

const REQUIRED_SCENARIOS = [
  "weak",
  "average",
  "strong",
  "grammar-heavy",
  "vocabulary-heavy",
  "poor-task-response",
];

describe("calibration fixtures", () => {
  it("contains every required scenario", () => {
    const ids = fixtures.essays.map((e) => e.id);
    for (const scenario of REQUIRED_SCENARIOS) {
      expect(ids).toContain(scenario);
    }
  });

  it("has a question that passes the production submission schema", () => {
    expect(writingSubmissionSchema.safeParse({ question: fixtures.question, essay: "x".repeat(60) }).success).toBe(true);
  });

  it("every essay passes the production submission schema", () => {
    for (const fixture of fixtures.essays) {
      const parsed = writingSubmissionSchema.safeParse({
        question: fixtures.question,
        essay: fixture.essay,
      });
      expect(parsed.success, `${fixture.id} failed validation`).toBe(true);
    }
  });

  it("only uses valid category-free data and 0.5-step reference bands", () => {
    for (const fixture of fixtures.essays) {
      if (!fixture.expected) continue;
      for (const band of Object.values(fixture.expected)) {
        expect(bandScoreSchema.safeParse(band).success, `${fixture.id}: invalid band ${band}`).toBe(true);
      }
      // Reference overall must be derivable by the production rounding rule.
      expect(computeOverall(fixture.expected)).toBeGreaterThan(0);
    }
  });

  it("covers the declared weakness profiles", () => {
    const byId = Object.fromEntries(fixtures.essays.map((e) => [e.id, e]));
    const band = (id: string, key: keyof NonNullable<Fixture["expected"]>) => byId[id].expected![key];

    // strong beats weak on every criterion
    for (const key of ["taskResponse", "coherenceCohesion", "lexicalResource", "grammar"] as const) {
      expect(band("strong", key)).toBeGreaterThan(band("weak", key));
    }
    // grammar-heavy is penalised on grammar relative to its other criteria
    expect(band("grammar-heavy", "grammar")).toBeLessThan(band("grammar-heavy", "taskResponse"));
    // vocabulary-heavy is penalised on lexis
    expect(band("vocabulary-heavy", "lexicalResource")).toBeLessThan(band("vocabulary-heavy", "grammar"));
    // poor task response is the lowest Task Response in the whole set
    const trs = fixtures.essays
      .filter((e) => e.expected && e.id !== "poor-task-response")
      .map((e) => e.expected!.taskResponse);
    expect(band("poor-task-response", "taskResponse")).toBeLessThan(Math.min(...trs));
  });

  it("includes an under-length essay for Task Response penalties", () => {
    const underlength = fixtures.essays.find((e) => e.id === "underlength");
    expect(underlength).toBeDefined();
    expect(countWords(underlength!.essay)).toBeLessThan(250);
  });

  it("does not contain obvious real-user data (no emails or phone numbers)", () => {
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
    expect(raw).not.toMatch(/\+\d{9,}/);
  });

  it("keeps the error categories declared by the schema in sync with the UI", () => {
    expect([...ERROR_CATEGORIES]).toEqual([
      "grammar",
      "vocabulary",
      "spelling",
      "punctuation",
      "style",
      "coherence",
    ]);
  });
});
