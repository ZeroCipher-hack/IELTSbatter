import { computeOverall, type CriterionScores } from "@/lib/utils/scoring";
import type { GradingMeta, WritingGradingResponse, WritingGradingResult } from "./schema";

/** Map a validated AI payload onto the four criterion bands. */
export function criterionScoresOf(data: WritingGradingResponse): CriterionScores {
  return {
    taskResponse: data.scores.taskResponse.band,
    coherenceCohesion: data.scores.coherenceCohesion.band,
    lexicalResource: data.scores.lexicalResource.band,
    grammar: data.scores.grammar.band,
  };
}

/**
 * Single place where a validated AI payload becomes a grading result:
 * the overall band is ALWAYS recomputed on the server (never trusted from
 * the model), and meta carries everything needed for persistence/debugging.
 */
export function finalizeGradingResult(params: {
  data: WritingGradingResponse;
  meta: GradingMeta;
}): WritingGradingResult {
  const { data, meta } = params;

  return {
    data,
    overall: computeOverall(criterionScoresOf(data)),
    meta,
  };
}
