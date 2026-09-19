/**
 * Speaking AI provider contracts.
 *
 * The speaking pipeline has two swappable halves, both isolated behind these
 * interfaces so the application never talks to a provider SDK directly:
 *
 *   audio  ->  TranscriptionProvider  ->  transcript
 *   transcript ->  SpeakingGrader    ->  structured evaluation
 *
 * Providers: `GeminiTranscriptionProvider` / `GeminiSpeakingGrader` (real) and
 * `MockTranscriptionProvider` / `MockSpeakingGrader` (development + tests).
 * Results produced by a mock are flagged `isMock` and must be labelled MOCK in
 * the UI — they are never presented as real AI output.
 */
import { z } from "zod";

export const SPEAKING_GRADING_PROMPT_V1 = "SPEAKING_GRADING_PROMPT_V1";

/** Band scores follow the same rule as Writing: 0–9 in 0.5 steps. */
export const speakingBandSchema = z
  .number()
  .min(0)
  .max(9)
  .refine((value) => Number.isInteger(value * 2), { message: "Band score must be in 0.5 steps" });

export const SPEAKING_CRITERIA = [
  "fluencyCoherence",
  "lexicalResource",
  "grammaticalRange",
  "pronunciation",
] as const;

export type SpeakingCriterion = (typeof SPEAKING_CRITERIA)[number];

const criterionSchema = z.object({
  band: speakingBandSchema,
  note: z.string().min(1),
});

/** Strict JSON contract the speaking grader must return. */
export const speakingEvaluationSchema = z.object({
  scores: z.object({
    fluencyCoherence: criterionSchema,
    lexicalResource: criterionSchema,
    grammaticalRange: criterionSchema,
    pronunciation: criterionSchema,
  }),
  /** Informational only — the platform recomputes the overall band. */
  overall: speakingBandSchema.optional(),
  summary: z.string().min(1).max(4000),
  strengths: z.array(z.string().min(1)).min(1).max(10),
  weaknesses: z.array(z.string().min(1)).min(1).max(10),
  improvements: z.array(z.string().min(1)).min(1).max(10),
});

export type SpeakingEvaluationResponse = z.infer<typeof speakingEvaluationSchema>;

/* ------------------------------------------------------------ transcription */

export interface TranscriptionInput {
  audio: Buffer;
  mimeType: string;
  /** BCP-47-ish hint ("en", "uz", "ru"); providers may ignore it. */
  language?: string;
}

export interface TranscriptionResult {
  transcript: string;
  provider: string;
  model: string;
  isMock: boolean;
  latencyMs: number;
  raw?: string | null;
  /** True when the provider could not return usable speech (silence/noise). */
  empty?: boolean;
}

export interface TranscriptionProvider {
  readonly name: string;
  readonly model: string;
  readonly isMock: boolean;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

/* --------------------------------------------------------------- evaluation */

export interface SpeakingGradingInput {
  transcript: string;
  /** The question/cue card the learner was answering, for context. */
  question: string;
  /** Test part (1..3) when known. */
  part?: number | null;
  /** Feedback language for the prose fields ("uz" | "ru" | "en"). */
  feedbackLocale?: string;
}

export interface SpeakingGradingMeta {
  provider: string;
  model: string;
  promptVersion: string;
  isMock: boolean;
  latencyMs: number;
  attempts: number;
  retryCount: number;
  validationStatus: "VALID" | "INVALID_JSON" | "SCHEMA_MISMATCH" | "PROVIDER_ERROR";
  validationErrors: string[];
  rawResponse?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface SpeakingGradingResult {
  evaluation: SpeakingEvaluationResponse;
  /** Recomputed on the server from the criterion bands. */
  overallBand: number;
  meta: SpeakingGradingMeta;
}

export interface SpeakingGrader {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly isMock: boolean;
  gradeSpeaking(input: SpeakingGradingInput): Promise<SpeakingGradingResult>;
}

/** Thrown when evaluation could not be completed within the retry budget. */
export class SpeakingGradingError extends Error {
  readonly details: SpeakingGradingMeta & { reason: string };

  constructor(details: SpeakingGradingMeta & { reason: string }) {
    super(`Speaking grading failed (${details.validationStatus}) after ${details.attempts} attempt(s)`);
    this.name = "SpeakingGradingError";
    this.details = details;
  }
}

/* ------------------------------------------------------------------ prompts */

export interface SpeakingPromptParams {
  question: string;
  transcript: string;
  part?: number | null;
  feedbackLocale?: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  uz: "Uzbek",
  ru: "Russian",
  en: "English",
};

/**
 * Prompt for the speaking grader. Versioned like the writing prompts: never
 * edit a released version in place, add the next one instead.
 */
export function buildSpeakingGradingPrompt(params: SpeakingPromptParams): string {
  const language = LANGUAGE_NAMES[params.feedbackLocale ?? "uz"] ?? "Uzbek";
  const part = params.part ? `IELTS Speaking Part ${params.part}` : "IELTS Speaking";

  return `You are an experienced, certified IELTS Speaking examiner. Evaluate the candidate's spoken answer below, which is provided as a transcript produced by an automatic speech recogniser.

CONTEXT
- Task: ${part}
- Question / cue card: ${params.question}

CRITERIA (official IELTS Speaking band descriptors)
1. Fluency and Coherence — speech rate, hesitation, repetition, self-correction, logical sequencing, cohesive devices.
2. Lexical Resource — range, precision, collocations, idiomatic language, paraphrase ability.
3. Grammatical Range and Accuracy — variety of structures, complex sentences, error density and severity.
4. Pronunciation — NOTE: you only see a transcript, so judge pronunciation conservatively from the evidence available (word choice patterns suggesting mispronunciation risk, filler words, self-corrections). If there is not enough evidence, give a mid-range band and say so explicitly in the note.

RULES
- Grade strictly and consistently. Do NOT inflate scores, do NOT reward effort.
- Every score must be justified by concrete evidence quoted from the transcript.
- Give each criterion a band in 0.5 steps between 0.0 and 9.0.
- Report each distinct weakness ONCE with a representative example instead of listing duplicates.
- "overall" is informational; the platform recomputes it from the four criteria.
- Write summary, strengths, weaknesses and improvements in ${language}.

TRANSCRIPT
"""
${params.transcript}
"""

Return ONLY valid JSON in exactly this shape:
{
  "scores": {
    "fluencyCoherence": { "band": 6.0, "note": "..." },
    "lexicalResource": { "band": 6.5, "note": "..." },
    "grammaticalRange": { "band": 6.0, "note": "..." },
    "pronunciation": { "band": 6.0, "note": "..." }
  },
  "overall": 6.0,
  "summary": "...",
  "strengths": ["..."],
  "weaknesses": ["..."],
  "improvements": ["..."]
}`;
}
