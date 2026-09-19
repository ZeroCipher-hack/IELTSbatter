import { normalizeBand } from "@/lib/utils/scoring";
import type {
  SpeakingEvaluationResponse,
  SpeakingGradingMeta,
  SpeakingGradingResult,
} from "./types";

/** Criterion bands extracted from a validated payload. */
export function speakingCriterionBands(data: SpeakingEvaluationResponse): number[] {
  const scores = data.scores;
  return [
    normalizeBand(scores.fluencyCoherence.band),
    normalizeBand(scores.lexicalResource.band),
    normalizeBand(scores.grammaticalRange.band),
    normalizeBand(scores.pronunciation.band),
  ];
}

/**
 * Speaking overall band, computed on the server from the four criteria using
 * the official IELTS rounding (mean ending in .25/.75 rounds up to the next
 * half band). The model's own `overall` field is informational only.
 */
export function computeSpeakingOverall(data: SpeakingEvaluationResponse): number {
  const bands = speakingCriterionBands(data);
  const mean = bands.reduce((sum, band) => sum + band, 0) / bands.length;
  const floor = Math.floor(mean * 2) / 2;
  const remainder = +(mean - floor).toFixed(3);
  return remainder >= 0.25 ? normalizeBand(floor + 0.5) : normalizeBand(floor);
}

/** Attach the backend-computed overall band to a validated evaluation. */
export function finalizeSpeakingResult(params: {
  data: SpeakingEvaluationResponse;
  meta: SpeakingGradingMeta;
}): SpeakingGradingResult {
  const { data, meta } = params;
  return { evaluation: data, overallBand: computeSpeakingOverall(data), meta };
}
