import { computeOverall } from "@/lib/utils/scoring";
import type { GradingMeta, WritingGradingResponse, WritingGradingResult } from "./schema";

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
    overall: computeOverall({
      taskResponse: data.scores.taskResponse.band,
      coherenceCohesion: data.scores.coherenceCohesion.band,
      lexicalResource: data.scores.lexicalResource.band,
      grammar: data.scores.grammar.band,
    }),
    meta,
  };
}
