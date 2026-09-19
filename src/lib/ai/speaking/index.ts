/**
 * Speaking AI entry point.
 *
 * The application imports ONLY from this file — never from gemini.ts or
 * mock.ts directly — so swapping providers touches this factory alone.
 *
 * Provider selection:
 *   AI_MODE=gemini + GEMINI_API_KEY set -> GeminiTranscriptionProvider / GeminiSpeakingGrader
 *   otherwise                           -> MockTranscriptionProvider / MockSpeakingGrader
 *
 * With mock providers every result carries isMock=true, which the UI must
 * display as MOCK. Mock output is for development and tests only.
 */
import { env } from "@/lib/env";
import { GeminiSpeakingGrader, GeminiTranscriptionProvider } from "./gemini";
import { MockSpeakingGrader, MockTranscriptionProvider } from "./mock";
import type { SpeakingGrader, TranscriptionProvider } from "./types";

let cachedTranscriber: TranscriptionProvider | undefined;
let cachedGrader: SpeakingGrader | undefined;

let warnedAboutMissingKey = false;

/**
 * Gemini is used only when the mode says so AND a key is actually present.
 * The key is read from the environment directly (never logged, never returned)
 * so this check can never throw; a missing key degrades to the mock providers,
 * which the UI labels as MOCK.
 */
function geminiEnabled(): boolean {
  const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 0);
  const wantsGemini = env.aiMode === "gemini";

  if (wantsGemini && !hasKey && !warnedAboutMissingKey) {
    warnedAboutMissingKey = true;
    console.warn(
      "[ai] AI_MODE=gemini but GEMINI_API_KEY is not set — speaking pipeline falls back to MOCK providers (results are labelled MOCK)."
    );
  }

  return wantsGemini && hasKey;
}

export function getTranscriptionProvider(): TranscriptionProvider {
  if (!cachedTranscriber) {
    cachedTranscriber = geminiEnabled() ? new GeminiTranscriptionProvider() : new MockTranscriptionProvider();
  }
  return cachedTranscriber;
}

export function getSpeakingGrader(): SpeakingGrader {
  if (!cachedGrader) {
    cachedGrader = geminiEnabled() ? new GeminiSpeakingGrader() : new MockSpeakingGrader();
  }
  return cachedGrader;
}

/** For tests: inject providers, or `undefined` to reset to the configured ones. */
export function setSpeakingProvidersForTesting(providers: {
  transcriber?: TranscriptionProvider;
  grader?: SpeakingGrader;
}): void {
  cachedTranscriber = providers.transcriber;
  cachedGrader = providers.grader;
}

/** True when both halves of the pipeline are mock (development mode). */
export function speakingPipelineIsMock(): boolean {
  return getTranscriptionProvider().isMock || getSpeakingGrader().isMock;
}

export { GeminiSpeakingGrader, GeminiTranscriptionProvider } from "./gemini";
export { MockSpeakingGrader, MockTranscriptionProvider } from "./mock";
export {
  SPEAKING_CRITERIA,
  SPEAKING_GRADING_PROMPT_V1,
  SpeakingGradingError,
  buildSpeakingGradingPrompt,
  speakingEvaluationSchema,
  type SpeakingCriterion,
  type SpeakingEvaluationResponse,
  type SpeakingGradingInput,
  type SpeakingGradingMeta,
  type SpeakingGradingResult,
  type SpeakingGrader,
  type TranscriptionInput,
  type TranscriptionProvider,
  type TranscriptionResult,
} from "./types";
export { computeSpeakingOverall, speakingCriterionBands } from "./result";
