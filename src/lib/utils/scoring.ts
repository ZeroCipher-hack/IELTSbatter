/**
 * IELTS Writing scoring helpers.
 *
 * The overall band is ALWAYS computed on the backend from the four criterion
 * scores — never taken verbatim from the AI — so the model cannot invent an
 * arbitrary overall score.
 */

export interface CriterionScores {
  taskResponse: number;
  coherenceCohesion: number;
  lexicalResource: number;
  grammar: number;
}

/** Clamp to [0, 9] and snap to the nearest 0.5 step. */
export function normalizeBand(value: number): number {
  const clamped = Math.min(9, Math.max(0, value));
  return Math.round(clamped * 2) / 2;
}

/**
 * Official IELTS rounding of the criteria mean:
 *  - the mean of the four criteria is rounded to the nearest 0.5;
 *  - a mean ending in exactly .25 rounds UP to the next half band (6.25 -> 6.5);
 *  - a mean ending in exactly .75 rounds UP to the next whole band (6.75 -> 7.0).
 */
export function computeOverall(scores: CriterionScores): number {
  const mean =
    (normalizeBand(scores.taskResponse) +
      normalizeBand(scores.coherenceCohesion) +
      normalizeBand(scores.lexicalResource) +
      normalizeBand(scores.grammar)) /
    4;

  const floor = Math.floor(mean * 2) / 2; // nearest 0.5 below or equal
  const remainder = +(mean - floor).toFixed(3);

  // remainder is in [0, 0.5); .25 (and anything above) rounds up per IELTS.
  if (remainder >= 0.25) return normalizeBand(floor + 0.5);
  return normalizeBand(floor);
}

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}
