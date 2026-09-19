/**
 * Mock speaking providers.
 *
 * These are used when AI_MODE=mock (no Gemini credentials) and in automated
 * tests. Everything they produce is deterministic and flagged `isMock: true`
 * so the UI can label it MOCK — mock output must never be presented as a real
 * AI evaluation.
 */
import { createHash } from "node:crypto";
import { countWords } from "@/lib/utils/scoring";
import { finalizeSpeakingResult } from "./result";
import {
  SPEAKING_GRADING_PROMPT_V1,
  type SpeakingGradingInput,
  type SpeakingGradingResult,
  type SpeakingGrader,
  type TranscriptionInput,
  type TranscriptionProvider,
  type TranscriptionResult,
} from "./types";

/** Deterministic, clearly-marked pseudo transcript derived from the audio. */
export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = "mock";
  readonly model = "mock-transcriber-1";
  readonly isMock = true;

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const startedAt = Date.now();
    const digest = createHash("sha256").update(input.audio).digest("hex");
    const seed = parseInt(digest.slice(0, 6), 16);
    const seconds = Math.max(1, Math.round(input.audio.length / 16000));
    const sentences = MOCK_SENTENCES[seed % MOCK_SENTENCES.length];

    const transcript =
      `[MOCK TRANSCRIPT — generated for development, not a real transcription] ` +
      `${sentences} (audio: ${input.mimeType}, ~${seconds}s, bytes: ${input.audio.length})`;

    return {
      transcript,
      provider: this.name,
      model: this.model,
      isMock: true,
      latencyMs: Date.now() - startedAt,
      raw: null,
      empty: false,
    };
  }
}

const MOCK_SENTENCES = [
  "Well, I would say that I really enjoy living in my city because it is quite lively, although the traffic can be frustrating at times, so I usually cycle to work instead of driving.",
  "In my opinion, learning a foreign language is essential nowadays; for example, I have been studying English for about five years and it has opened many opportunities for me.",
  "That is an interesting question. I suppose I prefer spending my free time outdoors, particularly hiking in the mountains with my friends, and we often take photographs while we walk.",
  "Actually, I have mixed feelings about social media. On the one hand it helps me stay in touch with relatives abroad, but on the other hand it takes up far too much of my time.",
];

/**
 * Deterministic mock grader: scores depend on transcript length so the whole
 * pipeline (record -> transcribe -> evaluate -> store -> result page) can be
 * exercised end to end without credentials.
 */
export class MockSpeakingGrader implements SpeakingGrader {
  readonly provider = "mock";
  readonly model = "mock-speaking-grader-1";
  readonly promptVersion = SPEAKING_GRADING_PROMPT_V1;
  readonly isMock = true;

  async gradeSpeaking(input: SpeakingGradingInput): Promise<SpeakingGradingResult> {
    const startedAt = Date.now();
    const words = countWords(input.transcript);
    const seed = createHash("sha256").update(input.transcript).digest()[0] % 4;

    // Longer answers score (slightly) better, mirroring the real rubric's
    // emphasis on extended, sustained speech.
    const base = words < 20 ? 5.0 : words < 60 ? 6.0 : 6.5;
    const bump = (index: number) => clampBand(base + (seed === index ? 0.5 : 0));

    const data = {
      scores: {
        fluencyCoherence: {
          band: bump(0),
          note: "[MOCK] Fluency estimate derived from transcript length; not a real assessment.",
        },
        lexicalResource: {
          band: bump(1),
          note: "[MOCK] Vocabulary estimate derived from transcript length; not a real assessment.",
        },
        grammaticalRange: {
          band: bump(2),
          note: "[MOCK] Grammar estimate derived from transcript length; not a real assessment.",
        },
        pronunciation: {
          band: bump(3),
          note: "[MOCK] Pronunciation cannot be judged from a transcript and is not assessed here.",
        },
      },
      overall: base,
      summary:
        "[MOCK] This is a development placeholder produced without any AI provider. " +
        "Connect an AI provider (AI_MODE=gemini with credentials) to receive a real evaluation.",
      strengths: ["[MOCK] Produced enough speech to be graded.", "[MOCK] Kept answering until the timer ended."],
      weaknesses: ["[MOCK] No real analysis was performed for this attempt."],
      improvements: [
        "[MOCK] Record a real attempt once the AI provider is configured.",
        "[MOCK] Practise extending answers with reasons and examples.",
      ],
    };

    return finalizeSpeakingResult({
      data,
      meta: {
        provider: this.provider,
        model: this.model,
        promptVersion: this.promptVersion,
        isMock: true,
        latencyMs: Date.now() - startedAt,
        attempts: 1,
        retryCount: 0,
        validationStatus: "VALID",
        validationErrors: [],
        rawResponse: null,
        inputTokens: null,
        outputTokens: null,
      },
    });
  }
}

function clampBand(value: number): number {
  const clamped = Math.min(9, Math.max(0, value));
  return Math.round(clamped * 2) / 2;
}
