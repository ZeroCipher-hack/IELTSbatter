/**
 * IELTS raw-score -> band conversion.
 *
 * Raw scores are reported out of 40 in the real test. Shorter practice papers
 * are scaled to 40 before the table is applied, so a 14-question test still
 * yields a meaningful band. Keeping the tables here means changing the mapping
 * (or adding a subject-specific variant) touches exactly one file.
 *
 * These tables are the widely published IELTS conversion guides; they are
 * estimates, not an official Cambridge conversion.
 */
import type { QuestionDefinition, ResponseMap } from "./types";

export type TestModule = "READING" | "LISTENING";

export interface BandRange {
  /** Minimum raw score (inclusive) for this band. */
  min: number;
  band: number;
}

/** Reading (Academic) raw -> band, out of 40. */
export const READING_BAND_TABLE: readonly BandRange[] = [
  { min: 39, band: 9.0 },
  { min: 37, band: 8.5 },
  { min: 35, band: 8.0 },
  { min: 33, band: 7.5 },
  { min: 30, band: 7.0 },
  { min: 27, band: 6.5 },
  { min: 23, band: 6.0 },
  { min: 19, band: 5.5 },
  { min: 15, band: 5.0 },
  { min: 13, band: 4.5 },
  { min: 10, band: 4.0 },
  { min: 8, band: 3.5 },
  { min: 6, band: 3.0 },
  { min: 4, band: 2.5 },
  { min: 3, band: 2.0 },
  { min: 2, band: 1.5 },
  { min: 1, band: 1.0 },
  { min: 0, band: 0 },
];

/** Listening raw -> band, out of 40. */
export const LISTENING_BAND_TABLE: readonly BandRange[] = [
  { min: 39, band: 9.0 },
  { min: 37, band: 8.5 },
  { min: 35, band: 8.0 },
  { min: 32, band: 7.5 },
  { min: 30, band: 7.0 },
  { min: 26, band: 6.5 },
  { min: 23, band: 6.0 },
  { min: 18, band: 5.5 },
  { min: 16, band: 5.0 },
  { min: 13, band: 4.5 },
  { min: 10, band: 4.0 },
  { min: 8, band: 3.5 },
  { min: 6, band: 3.0 },
  { min: 4, band: 2.5 },
  { min: 3, band: 2.0 },
  { min: 2, band: 1.5 },
  { min: 1, band: 1.0 },
  { min: 0, band: 0 },
];

export const BAND_TABLES: Record<TestModule, readonly BandRange[]> = {
  READING: READING_BAND_TABLE,
  LISTENING: LISTENING_BAND_TABLE,
};

/** Raw score that the tables are defined against. */
export const BAND_TABLE_BASE = 40;

/**
 * Optional override so an operator can replace a mapping without a code change.
 * Expected shape: `{ "READING": [{ "min": 39, "band": 9 }, ...] }` (out of 40).
 */
export function resolveBandTable(module: TestModule, override?: string | null): readonly BandRange[] {
  if (override) {
    try {
      const parsed = JSON.parse(override) as Record<string, BandRange[]>;
      const table = parsed[module];
      if (Array.isArray(table) && table.length > 0) {
        return table.slice().sort((a, b) => b.min - a.min);
      }
    } catch {
      // A malformed override must never break grading — fall back to the default.
    }
  }
  return BAND_TABLES[module];
}

/**
 * Scale a raw score to the /40 table when the practice test has fewer
 * questions, then map it to a band.
 */
export function rawToBand(
  module: TestModule,
  rawScore: number,
  maxScore: number,
  table?: readonly BandRange[]
): number {
  if (maxScore <= 0) return 0;
  const clamped = Math.max(0, Math.min(rawScore, maxScore));
  const scaled = Math.round((clamped / maxScore) * BAND_TABLE_BASE);
  return bandForRaw(module, scaled, table);
}

/** Map an already-scaled (/40) raw score to a band. */
export function bandForRaw(
  module: TestModule,
  rawOutOf40: number,
  table?: readonly BandRange[]
): number {
  const ranges = table ?? BAND_TABLES[module];
  const score = Math.max(0, Math.min(BAND_TABLE_BASE, Math.round(rawOutOf40)));
  for (const range of ranges) {
    if (score >= range.min) return range.band;
  }
  return 0;
}

/** Band for objective modules is always a 0.5 step between 0 and 9. */
export function normalizeBand(band: number): number {
  const clamped = Math.min(9, Math.max(0, band));
  return Math.round(clamped * 2) / 2;
}

/** Percentage of correct answers — used for progress UI. */
export function scorePercentage(rawScore: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.round((rawScore / maxScore) * 100);
}

/** Result produced by the scoring engine for one module attempt. */
export interface ScoredAttempt {
  correctCount: number;
  rawScore: number;
  maxScore: number;
  totalQuestions: number;
  band: number;
  percentage: number;
  perQuestion: ScoredQuestion[];
}

export interface ScoredQuestion {
  questionId: string;
  number: number;
  correct: boolean;
  awardedPoints: number;
  given: string | string[] | null;
}

export type { QuestionDefinition, ResponseMap };
