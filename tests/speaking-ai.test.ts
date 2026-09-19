/**
 * Unit tests for the speaking AI layer (providers, factory, prompt, schema).
 * No network access: the Gemini providers are driven by injected transports.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  GeminiSpeakingGrader,
  MockSpeakingGrader,
  MockTranscriptionProvider,
  SPEAKING_GRADING_PROMPT_V1,
  SpeakingGradingError,
  buildSpeakingGradingPrompt,
  computeSpeakingOverall,
  getSpeakingGrader,
  getTranscriptionProvider,
  setSpeakingProvidersForTesting,
  speakingEvaluationSchema,
} from "@/lib/ai/speaking";
import type { GeminiAudioTransport, GeminiSpeakingTransport } from "@/lib/ai/speaking/gemini";
import { MAX_INLINE_AUDIO_BYTES, GeminiTranscriptionProvider } from "@/lib/ai/speaking/gemini";

const VALID_PAYLOAD = {
  scores: {
    fluencyCoherence: { band: 6.0, note: "Some hesitation but generally fluent." },
    lexicalResource: { band: 6.5, note: "Good range of topic vocabulary." },
    grammaticalRange: { band: 6.0, note: "Mix of simple and complex forms." },
    pronunciation: { band: 6.0, note: "Mostly intelligible; judged from transcript clues only." },
  },
  overall: 6.0,
  summary: "A clear, reasonably developed answer.",
  strengths: ["Clear structure"],
  weaknesses: ["Limited idiomatic language"],
  improvements: ["Practise topic-specific collocations"],
};

/** Transport double that replays scripted answers and counts calls. */
function scriptedTransport(steps: Array<{ text?: string; error?: unknown }>) {
  let index = 0;
  const calls: string[] = [];
  const transport: GeminiSpeakingTransport = {
    async generate(prompt: string) {
      calls.push(prompt);
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step.error) throw step.error;
      return { text: step.text ?? "", inputTokens: 100, outputTokens: 200 };
    },
  };
  return { transport, calls: () => calls };
}

afterEach(() => {
  setSpeakingProvidersForTesting({});
});

describe("mock providers", () => {
  it("transcribes deterministically and flags the result as mock", async () => {
    const provider = new MockTranscriptionProvider();
    const audio = Buffer.from("fake-audio-bytes");

    const first = await provider.transcribe({ audio, mimeType: "audio/webm" });
    const second = await provider.transcribe({ audio, mimeType: "audio/webm" });

    expect(first.isMock).toBe(true);
    expect(first.transcript).toBe(second.transcript);
    expect(first.transcript).toContain("MOCK TRANSCRIPT");
    expect(provider.name).toBe("mock");
  });

  it("produces a schema-valid evaluation with mock flags and a backend overall", async () => {
    const grader = new MockSpeakingGrader();
    const result = await grader.gradeSpeaking({
      transcript: "This is a fairly long mock transcript used for testing the pipeline behaviour.",
      question: "Describe your city.",
      part: 1,
      feedbackLocale: "uz",
    });

    expect(speakingEvaluationSchema.safeParse(result.evaluation).success).toBe(true);
    expect(result.meta.isMock).toBe(true);
    expect(result.meta.provider).toBe("mock");
    expect(result.overallBand).toBe(computeSpeakingOverall(result.evaluation));
    expect(result.evaluation.summary).toContain("MOCK");
  });
});

describe("overall band", () => {
  it("rounds .25 and .75 up according to the IELTS rule", () => {
    const withBands = (bands: [number, number, number, number]) => ({
      scores: {
        fluencyCoherence: { band: bands[0], note: "n" },
        lexicalResource: { band: bands[1], note: "n" },
        grammaticalRange: { band: bands[2], note: "n" },
        pronunciation: { band: bands[3], note: "n" },
      },
      summary: "s",
      strengths: ["a"],
      weaknesses: ["b"],
      improvements: ["c"],
    });

    // 6.25 mean -> 6.5
    expect(computeSpeakingOverall(withBands([6.0, 6.5, 6.0, 6.5]))).toBe(6.5);
    // 6.75 mean -> 7.0
    expect(computeSpeakingOverall(withBands([6.5, 7.0, 7.0, 6.5]))).toBe(7.0);
    // exact mean stays put
    expect(computeSpeakingOverall(withBands([6.0, 6.0, 7.0, 7.0]))).toBe(6.5);
  });

  it("never trusts the model's own overall field", async () => {
    const { transport } = scriptedTransport([
      { text: JSON.stringify({ ...VALID_PAYLOAD, overall: 9.0 }) },
    ]);
    const grader = new GeminiSpeakingGrader({ transport, sleep: async () => {}, random: () => 0.5 });
    const result = await grader.gradeSpeaking({ transcript: "x".repeat(200), question: "Q" });

    expect(result.evaluation.overall).toBe(9.0); // informational, stored separately
    expect(result.overallBand).toBe(6.0); // recomputed from criteria
  });
});

describe("gemini speaking grader", () => {
  it("parses a valid JSON answer and reports meta", async () => {
    const { transport } = scriptedTransport([{ text: JSON.stringify(VALID_PAYLOAD) }]);
    const grader = new GeminiSpeakingGrader({
      transport,
      model: "test-model",
      sleep: async () => {},
      random: () => 0.5,
    });

    const result = await grader.gradeSpeaking({
      transcript: "Well, I think that living in a city has both advantages and disadvantages...",
      question: "Where do you live?",
      part: 1,
      feedbackLocale: "uz",
    });

    expect(result.meta.validationStatus).toBe("VALID");
    expect(result.meta.provider).toBe("gemini");
    expect(result.meta.model).toBe("test-model");
    expect(result.meta.promptVersion).toBe(SPEAKING_GRADING_PROMPT_V1);
    expect(result.meta.isMock).toBe(false);
    expect(result.meta.attempts).toBe(1);
    expect(result.meta.rawResponse).toContain("summary");
  });

  it("retries unusable output and succeeds on the second attempt", async () => {
    const { transport, calls } = scriptedTransport([
      { text: "not json at all" },
      { text: JSON.stringify(VALID_PAYLOAD) },
    ]);
    const grader = new GeminiSpeakingGrader({ transport, sleep: async () => {}, random: () => 0.5 });

    const result = await grader.gradeSpeaking({ transcript: "answer", question: "Q" });
    expect(result.meta.attempts).toBe(2);
    expect(result.meta.retryCount).toBe(1);
    expect(calls()).toHaveLength(2);
  });

  it("fails fast on a non-retryable provider error", async () => {
    const { transport, calls } = scriptedTransport([{ error: { status: 401, message: "API key not valid" } }]);
    const grader = new GeminiSpeakingGrader({ transport, sleep: async () => {}, random: () => 0.5 });

    await expect(grader.gradeSpeaking({ transcript: "answer", question: "Q" })).rejects.toBeInstanceOf(
      SpeakingGradingError
    );
    expect(calls()).toHaveLength(1);
  });

  it("retries transient provider errors up to the budget and then fails", async () => {
    const { transport, calls } = scriptedTransport([{ error: { status: 500, message: "server error" } }]);
    const grader = new GeminiSpeakingGrader({
      transport,
      maxAttempts: 3,
      sleep: async () => {},
      random: () => 0.5,
    });

    await expect(grader.gradeSpeaking({ transcript: "answer", question: "Q" })).rejects.toMatchObject({
      details: { attempts: 3, retryCount: 2, validationStatus: "PROVIDER_ERROR" },
    });
    expect(calls()).toHaveLength(3);
  });

  it("rejects an invalid evaluation shape (band outside 0.5 steps)", async () => {
    const invalid = {
      ...VALID_PAYLOAD,
      scores: { ...VALID_PAYLOAD.scores, fluencyCoherence: { band: 6.3, note: "odd band" } },
    };
    const { transport } = scriptedTransport([{ text: JSON.stringify(invalid) }]);
    const grader = new GeminiSpeakingGrader({
      transport,
      maxAttempts: 1,
      sleep: async () => {},
      random: () => 0.5,
    });

    await expect(grader.gradeSpeaking({ transcript: "answer", question: "Q" })).rejects.toMatchObject({
      details: { validationStatus: "SCHEMA_MISMATCH" },
    });
  });

  it("never leaks the API key into error details", async () => {
    const secret = "AIzaSyFAKE_SECRET_VALUE_1234567890";
    const { transport } = scriptedTransport([
      { error: new Error(`request failed with key ${secret} and header Authorization` ) },
    ]);
    const grader = new GeminiSpeakingGrader({
      transport,
      maxAttempts: 1,
      sleep: async () => {},
      random: () => 0.5,
    });

    try {
      await grader.gradeSpeaking({ transcript: "answer", question: "Q" });
      throw new Error("expected a failure");
    } catch (error) {
      const details = (error as SpeakingGradingError).details;
      expect(details.reason).not.toContain(secret);
      expect(JSON.stringify(details)).not.toContain(secret);
    }
  });
});

describe("gemini transcription provider", () => {
  const audioTransport = (text: string) => {
    const calls: Array<{ mimeType: string; model: string; dataLength: number }> = [];
    const transport: GeminiAudioTransport = {
      async transcribe(params) {
        calls.push({ mimeType: params.mimeType, model: params.model, dataLength: params.data.length });
        return { text };
      },
    };
    return { transport, calls: () => calls };
  };

  it("returns a plain transcript and flags it as non-mock", async () => {
    const { transport, calls } = audioTransport("  I live in an apartment near the city centre. ");
    const provider = new GeminiTranscriptionProvider({ transport, model: "audio-model" });

    const result = await provider.transcribe({
      audio: Buffer.from("pretend-audio"),
      mimeType: "audio/webm",
      language: "en",
    });

    expect(result.transcript).toBe("I live in an apartment near the city centre.");
    expect(result.isMock).toBe(false);
    expect(result.empty).toBe(false);
    expect(result.provider).toBe("gemini");
    expect(calls()[0]).toMatchObject({ mimeType: "audio/webm", model: "audio-model" });
  });

  it("flags silence as empty", async () => {
    const { transport } = audioTransport("EMPTY");
    const provider = new GeminiTranscriptionProvider({ transport });
    const result = await provider.transcribe({ audio: Buffer.from("x"), mimeType: "audio/wav" });
    expect(result.empty).toBe(true);
  });

  it("refuses audio that is too large to inline (no silent truncation)", async () => {
    const provider = new GeminiTranscriptionProvider({ transport: audioTransport("x").transport });
    await expect(
      provider.transcribe({
        audio: Buffer.alloc(MAX_INLINE_AUDIO_BYTES + 1),
        mimeType: "audio/wav",
      })
    ).rejects.toThrow(/audio_too_large/);
  });
});

describe("provider factory", () => {
  it("uses mock providers when AI_MODE is not gemini", () => {
    vi.stubEnv("AI_MODE", "mock");
    setSpeakingProvidersForTesting({});

    expect(getSpeakingGrader().isMock).toBe(true);
    expect(getTranscriptionProvider().isMock).toBe(true);
    vi.unstubAllEnvs();
  });

  it("falls back to mocks when gemini mode has no API key", () => {
    vi.stubEnv("AI_MODE", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "");
    setSpeakingProvidersForTesting({});

    expect(getSpeakingGrader().isMock).toBe(true);
    expect(getTranscriptionProvider().isMock).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("prompt", () => {
  it("includes the transcript, the task part and the feedback language", () => {
    const prompt = buildSpeakingGradingPrompt({
      question: "Describe a place you like.",
      transcript: "I would like to talk about the park near my house.",
      part: 2,
      feedbackLocale: "ru",
    });

    expect(prompt).toContain("IELTS Speaking Part 2");
    expect(prompt).toContain("I would like to talk about the park near my house.");
    expect(prompt).toContain("Russian");
    expect(prompt).toContain(SPEAKING_GRADING_PROMPT_V1.length ? "fluencyCoherence" : "");
  });
});
