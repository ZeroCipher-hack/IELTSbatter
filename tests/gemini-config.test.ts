/**
 * Misconfiguration must be diagnosable without ever exposing the key.
 * The provider factory is the only place that decides gemini vs mock.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { getGrader, setGraderForTesting } from "@/lib/ai/grading";
import { MockGrader } from "@/lib/ai/mock";
import { GeminiGrader } from "@/lib/ai/gemini";
import { env } from "@/lib/env";

const original = {
  mode: process.env.AI_MODE,
  key: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL,
};

afterEach(() => {
  vi.unstubAllEnvs();
  setGraderForTesting(undefined);
  for (const [k, v] of [
    ["AI_MODE", original.mode],
    ["GEMINI_API_KEY", original.key],
    ["GEMINI_MODEL", original.model],
  ] as const) {
    if (v === undefined) vi.stubEnv(k, "");
    else vi.stubEnv(k, v);
  }
});

describe("provider factory", () => {
  it("returns the mocked grader when AI_MODE=mock", () => {
    vi.stubEnv("AI_MODE", "mock");
    setGraderForTesting(undefined);
    expect(getGrader()).toBeInstanceOf(MockGrader);
  });

  it("returns the Gemini grader when AI_MODE=gemini and a key exists", () => {
    vi.stubEnv("AI_MODE", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    setGraderForTesting(undefined);
    expect(getGrader()).toBeInstanceOf(GeminiGrader);
  });

  it("uses GEMINI_MODEL from the environment, never a hardcoded value", () => {
    vi.stubEnv("AI_MODE", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    vi.stubEnv("GEMINI_MODEL", "gemini-configured-by-env");
    setGraderForTesting(undefined);
    expect(getGrader().model).toBe("gemini-configured-by-env");
  });

  it("fails with a clear, secret-free error when the key is missing", () => {
    vi.stubEnv("AI_MODE", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "");
    setGraderForTesting(undefined);

    let message = "";
    try {
      getGrader();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("GEMINI_API_KEY");
    expect(message).not.toMatch(/AIza/);
    expect(message).not.toContain("test-key-not-real");
  });

  it("reports the configured prompt version on the grader", () => {
    vi.stubEnv("AI_MODE", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    vi.stubEnv("AI_PROMPT_VERSION", "V1");
    setGraderForTesting(undefined);
    expect(getGrader().promptVersion).toBe("WRITING_GRADING_PROMPT_V1");
  });
});

describe("env accessor", () => {
  it("keeps the API key out of error messages for other variables", () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    try {
      // DATABASE_URL is intentionally not set in this assertion path.
      vi.stubEnv("DATABASE_URL", "");
      void env.databaseUrl;
      throw new Error("expected env.databaseUrl to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("DATABASE_URL");
      expect(message).not.toContain("test-key-not-real");
    }
  });

  it("defaults the retry/timeout knobs to bounded values", () => {
    expect(env.geminiMaxAttempts).toBeGreaterThanOrEqual(1);
    expect(env.geminiMaxAttempts).toBeLessThanOrEqual(10);
    expect(env.geminiTimeoutMs).toBeGreaterThan(0);
    expect(env.geminiRetryBaseMs).toBeGreaterThan(0);
  });
});
