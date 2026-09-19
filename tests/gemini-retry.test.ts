/**
 * Reliability tests for the Gemini grader: timeout/retry/backoff behaviour,
 * invalid-output handling and fail-fast on configuration errors.
 *
 * The provider transport is injected, so no network call is ever made.
 */
import { describe, it, expect, vi } from "vitest";
import { AIGradingError, GeminiGrader } from "@/lib/ai/gemini";
import { captureGradingFailure, httpError, scriptedTransport, validAiJson } from "./helpers/ai-fixtures";

const input = {
  question: "Discuss both views and give your opinion.",
  essay: "A test essay " + "word ".repeat(250),
  feedbackLocale: "uz",
};

/** Grader wired to a scripted transport with instant (recorded) sleeps. */
function makeGrader(
  steps: Parameters<typeof scriptedTransport>[0],
  options: Partial<ConstructorParameters<typeof GeminiGrader>[0]> = {}
) {
  const scripted = scriptedTransport(steps);
  const delays: number[] = [];
  const retries: Array<{ attempt: number; delayMs: number; reason: string }> = [];

  const grader = new GeminiGrader({
    transport: scripted.transport,
    model: "test-model",
    maxAttempts: 3,
    retryBaseMs: 100,
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 0.5, // no jitter in tests
    onRetry: (info) => retries.push(info),
    ...options,
  });

  return { grader, scripted, delays, retries };
}

describe("GeminiGrader — success path", () => {
  it("returns validated data, server-computed overall and full meta", async () => {
    const { grader, scripted } = makeGrader([
      { text: validAiJson(), inputTokens: 1200, outputTokens: 340 },
    ]);

    const result = await grader.gradeWriting(input);

    expect(scripted.callCount).toBe(1);
    expect(result.data.scores.taskResponse.band).toBe(6.5);
    // (6.5 + 6 + 6.5 + 6) / 4 = 6.25 -> 6.5 with IELTS rounding
    expect(result.overall).toBe(6.5);
    expect(result.meta).toMatchObject({
      provider: "gemini",
      model: "test-model",
      promptVersion: "WRITING_GRADING_PROMPT_V2",
      attempts: 1,
      retryCount: 0,
      validationStatus: "VALID",
      inputTokens: 1200,
      outputTokens: 340,
    });
    expect(result.meta.validationErrors).toEqual([]);
  });

  it("ignores the model's own overall field (backend recomputes it)", async () => {
    const { grader } = makeGrader([{ text: validAiJson({ overall: 9 }) }]);
    const result = await grader.gradeWriting(input);
    expect(result.overall).toBe(6.5); // not 9
  });

  it("accepts fenced JSON and tolerates frequency sent as a string", async () => {
    const payload = JSON.parse(validAiJson());
    payload.errors[0].frequency = "5";
    const { grader } = makeGrader([{ text: "```json\n" + JSON.stringify(payload) + "\n```" }]);

    const result = await grader.gradeWriting(input);
    expect(result.data.errors[0].frequency).toBe(5);
    expect(result.data.errors[0].isSystematic).toBe(true);
  });
});

describe("GeminiGrader — invalid model output", () => {
  it("retries invalid JSON, then succeeds", async () => {
    const { grader, scripted, delays } = makeGrader([
      { text: "I am sorry, here is your grade: A+" },
      { text: validAiJson() },
    ]);

    const result = await grader.gradeWriting(input);

    expect(scripted.callCount).toBe(2);
    expect(result.overall).toBe(6.5);
    expect(result.meta.attempts).toBe(2);
    expect(result.meta.retryCount).toBe(1);
    // Exponential backoff: 100 * 2^0 with no jitter.
    expect(delays).toEqual([100]);
  });

  it("retries schema mismatches (out-of-step band) and reports the issue", async () => {
    const invalid = JSON.parse(validAiJson());
    invalid.scores.grammar.band = 6.3;

    const { grader } = makeGrader([{ text: JSON.stringify(invalid) }, { text: validAiJson() }]);
    const result = await grader.gradeWriting(input);

    expect(result.meta.attempts).toBe(2);
    expect(result.meta.validationStatus).toBe("VALID");
  });

  it("retries a response with a missing required field", async () => {
    const invalid = JSON.parse(validAiJson());
    delete invalid.summary;

    const { grader } = makeGrader([{ text: JSON.stringify(invalid) }, { text: validAiJson() }]);
    const result = await grader.gradeWriting(input);

    expect(result.meta.attempts).toBe(2);
    expect(result.data.summary.length).toBeGreaterThan(0);
  });

  it("retries an unsupported error category", async () => {
    const invalid = JSON.parse(validAiJson());
    invalid.errors[0].category = "handwriting";

    const { grader } = makeGrader([{ text: JSON.stringify(invalid) }, { text: validAiJson() }]);
    const result = await grader.gradeWriting(input);

    expect(result.meta.attempts).toBe(2);
    expect(result.data.errors[0].category).toBe("grammar");
  });

  it("fails with SCHEMA_MISMATCH details after exhausting the retry budget", async () => {
    const invalid = JSON.parse(validAiJson());
    invalid.scores.taskResponse.band = 9.5; // impossible band

    const { grader, scripted } = makeGrader([
      { text: JSON.stringify(invalid) },
      { text: JSON.stringify(invalid) },
      { text: JSON.stringify(invalid) },
    ]);

    const error = await captureGradingFailure(grader.gradeWriting(input));

    expect(error).toBeInstanceOf(AIGradingError);
    expect(scripted.callCount).toBe(3); // bounded — never infinite
    expect(error.details).toMatchObject({
      attempts: 3,
      retryCount: 2,
      validationStatus: "SCHEMA_MISMATCH",
      promptVersion: "WRITING_GRADING_PROMPT_V2",
      model: "test-model",
    });
    expect(error.details.validationErrors.length).toBeGreaterThan(0);
    expect(error.details.rawResponse).toContain("9.5"); // raw response is kept
  });

  it("reports INVALID_JSON when the model never returns JSON", async () => {
    const { grader } = makeGrader([
      { text: "not json at all" },
      { text: "still not json" },
      { text: "nope" },
    ]);

    const error = await captureGradingFailure(grader.gradeWriting(input));
    expect(error.details.validationStatus).toBe("INVALID_JSON");
    expect(error.details.attempts).toBe(3);
  });
});

describe("GeminiGrader — provider errors", () => {
  it("retries 429 rate limits with exponential backoff", async () => {
    const { grader, scripted, delays, retries } = makeGrader([
      { error: httpError(429, "Quota exceeded") },
      { error: httpError(503, "Service unavailable") },
      { text: validAiJson() },
    ]);

    const result = await grader.gradeWriting(input);

    expect(scripted.callCount).toBe(3);
    expect(result.meta.attempts).toBe(3);
    expect(delays).toEqual([100, 200]); // 100 * 2^0, 100 * 2^1
    expect(retries).toHaveLength(2);
    expect(retries[0].reason).toContain("429");
  });

  it("retries timeouts and network failures", async () => {
    const { grader, delays } = makeGrader([
      { error: new Error("Gemini request timed out") },
      { error: new Error("fetch failed") },
      { text: validAiJson() },
    ]);

    const result = await grader.gradeWriting(input);
    expect(result.meta.attempts).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  it("fails fast (no retries) on an invalid API key / bad request", async () => {
    const { grader, scripted } = makeGrader([{ error: httpError(400, "API key not valid") }]);

    const error = await captureGradingFailure(grader.gradeWriting(input));

    expect(scripted.callCount).toBe(1);
    expect(error.details.attempts).toBe(1);
    expect(error.details.validationStatus).toBe("PROVIDER_ERROR");
  });

  it("stops at maxAttempts even when every call fails", async () => {
    const { grader, scripted } = makeGrader(
      [{ error: httpError(500) }, { error: httpError(500) }],
      { maxAttempts: 2 }
    );

    await expect(grader.gradeWriting(input)).rejects.toBeInstanceOf(AIGradingError);
    expect(scripted.callCount).toBe(2);
  });

  it("never leaks an API key from a provider error message", async () => {
    const { grader } = makeGrader([
      { error: httpError(400, "API key not valid: AIzaSyD-EXAMPLE-KEY-1234567890") },
    ]);

    const error = await captureGradingFailure(grader.gradeWriting(input));

    expect(error.details.reason).not.toContain("AIzaSyD-EXAMPLE-KEY-1234567890");
    expect(error.details.reason).toContain("[redacted]");
  });
});

describe("GeminiGrader — prompt/version wiring", () => {
  it("uses the requested prompt version and reports it in meta", async () => {
    const { grader, scripted } = makeGrader([{ text: validAiJson() }], {
      promptVersion: "WRITING_GRADING_PROMPT_V1",
    });

    const result = await grader.gradeWriting(input);

    expect(result.meta.promptVersion).toBe("WRITING_GRADING_PROMPT_V1");
    // V1 has no checkpoint lists; V2 does.
    expect(scripted.prompts[0]).not.toContain("NO SYCOPHANCY");
  });

  it("sends the V2 checklist prompt by default", async () => {
    const { grader, scripted } = makeGrader([{ text: validAiJson() }]);
    await grader.gradeWriting(input);

    expect(scripted.prompts[0]).toContain("NO SCORE INFLATION");
    expect(scripted.prompts[0]).toContain("frequency");
    expect(scripted.prompts[0]).toContain(input.question);
  });

  it("keeps the API key out of the prompt and never logs it", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { grader, scripted } = makeGrader([{ text: "garbage" }, { text: "garbage" }, { text: "garbage" }]);

    await grader.gradeWriting(input).catch(() => undefined);

    expect(scripted.prompts[0]).not.toMatch(/AIza/);
    for (const call of logSpy.mock.calls) {
      expect(String(call.join(" "))).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    }
    logSpy.mockRestore();
  });
});
