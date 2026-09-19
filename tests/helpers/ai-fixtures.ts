import type { GeminiTransport } from "@/lib/ai/gemini";

/** A schema-valid Gemini-shaped JSON payload. */
export function validAiJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    scores: {
      taskResponse: { band: 6.5, note: "Addresses both views with a clear position." },
      coherenceCohesion: { band: 6.0, note: "Clear paragraphing, some mechanical linking." },
      lexicalResource: { band: 6.5, note: "Good range with occasional collocation slips." },
      grammar: { band: 6.0, note: "Mix of complex and simple sentences." },
    },
    overall: 6.5,
    summary: "A competent essay with room to develop ideas further.",
    strengths: ["Clear position"],
    weaknesses: ["Underdeveloped second body paragraph"],
    improvements: ["Add concrete examples to each main idea"],
    errors: [
      {
        category: "grammar",
        originalText: "peoples is happy",
        correction: "people are happy",
        explanation: "Subject-verb agreement and irregular plural agreed form.",
        frequency: 4,
        isSystematic: true,
      },
    ],
    ...overrides,
  });
}

export interface ScriptedStep {
  /** Text returned, or an error to throw. */
  text?: string;
  error?: unknown;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

/**
 * Deterministic transport double: replays scripted results, records prompts and
 * enforces that the grader never makes more calls than it was given steps for.
 */
export function scriptedTransport(steps: ScriptedStep[]) {
  const prompts: string[] = [];
  let index = 0;

  const transport: GeminiTransport = {
    async generate(prompt: string) {
      prompts.push(prompt);
      const step = steps[index++];
      if (!step) throw new Error("transport called more times than scripted (infinite retry?)");
      if (step.error) throw step.error;
      return {
        text: step.text ?? "",
        inputTokens: step.inputTokens ?? null,
        outputTokens: step.outputTokens ?? null,
      };
    },
  };

  return {
    transport,
    get callCount() {
      return index;
    },
    get prompts() {
      return prompts;
    },
  };
}

/** Provider error carrying an HTTP status, like the Gemini SDK throws. */
export function httpError(status: number, message = `HTTP ${status}`): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

import { expect } from "vitest";
import { AIGradingError } from "@/lib/ai/gemini";

/** Await a promise that must fail, and return the typed AIGradingError. */
export async function captureGradingFailure(promise: Promise<unknown>): Promise<AIGradingError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AIGradingError);
    return error as AIGradingError;
  }
  throw new Error("expected grading to fail, but it succeeded");
}
