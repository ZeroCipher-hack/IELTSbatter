/**
 * Rule 11: development sees model / prompt version / timing / retries /
 * validation status; production sees none of it and never any secret.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { buildAiDebugInfo, debugInfoForResponse } from "@/lib/ai/debug";
import type { GradingMeta } from "@/lib/ai/schema";

const meta: GradingMeta = {
  provider: "gemini",
  model: "gemini-1.5-flash",
  promptVersion: "WRITING_GRADING_PROMPT_V2",
  rawResponse: "{}",
  latencyMs: 4210,
  attempts: 2,
  retryCount: 1,
  validationStatus: "VALID",
  validationErrors: [],
  inputTokens: 1500,
  outputTokens: 420,
};

const original = { debug: process.env.AI_DEBUG, nodeEnv: process.env.NODE_ENV };

afterEach(() => {
  vi.unstubAllEnvs();
  if (original.debug === undefined) delete process.env.AI_DEBUG;
  else process.env.AI_DEBUG = original.debug;
  vi.stubEnv("NODE_ENV", original.nodeEnv ?? "test");
});

describe("AI debug info", () => {
  it("exposes the required diagnostics", () => {
    const info = buildAiDebugInfo(meta);
    expect(info).toEqual({
      provider: "gemini",
      model: "gemini-1.5-flash",
      promptVersion: "WRITING_GRADING_PROMPT_V2",
      processingTimeMs: 4210,
      attempts: 2,
      retryCount: 1,
      validationStatus: "VALID",
      validationErrors: [],
      inputTokens: 1500,
      outputTokens: 420,
    });
  });

  it("never contains the raw provider response or any key material", () => {
    const info = buildAiDebugInfo({ ...meta, rawResponse: "API key AIzaSyD-EXAMPLE-KEY-1234567890" });
    expect(JSON.stringify(info)).not.toMatch(/AIza|rawResponse/);
  });

  it("is hidden in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.AI_DEBUG;
    expect(debugInfoForResponse(meta)).toBeUndefined();
  });

  it("can be forced on with AI_DEBUG=true even in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AI_DEBUG = "true";
    expect(debugInfoForResponse(meta)?.model).toBe("gemini-1.5-flash");
  });

  it("can be forced off in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.AI_DEBUG = "false";
    expect(debugInfoForResponse(meta)).toBeUndefined();
  });
});
