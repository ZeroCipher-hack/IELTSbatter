import { env } from "@/lib/env";
import type { GradingMeta } from "./schema";

/**
 * Development-only diagnostics for AI grading.
 *
 * Rule 11: in development the model, prompt version, processing time, retry
 * count and validation status are visible; in production none of it (and never
 * the API key or any other secret) is exposed.
 */
export interface AIDebugInfo {
  model: string;
  provider: string;
  promptVersion: string;
  processingTimeMs: number;
  attempts: number;
  retryCount: number;
  validationStatus: string;
  validationErrors: string[];
  inputTokens: number | null;
  outputTokens: number | null;
}

export function buildAiDebugInfo(meta: GradingMeta): AIDebugInfo {
  return {
    provider: meta.provider,
    model: meta.model,
    promptVersion: meta.promptVersion,
    processingTimeMs: meta.latencyMs,
    attempts: meta.attempts,
    retryCount: meta.retryCount,
    validationStatus: meta.validationStatus,
    validationErrors: meta.validationErrors,
    inputTokens: meta.inputTokens,
    outputTokens: meta.outputTokens,
  };
}

/**
 * Diagnostics attached to API responses in development only.
 * Production builds return `undefined`, so no internal detail leaks.
 */
export function debugInfoForResponse(meta: GradingMeta): AIDebugInfo | undefined {
  return env.aiDebug ? buildAiDebugInfo(meta) : undefined;
}

/** One-line, secret-free log of a grading run (dev mode only). */
export function logAiDebug(meta: GradingMeta): void {
  if (!env.aiDebug) return;
  console.log(
    `[ai:debug] provider=${meta.provider} model=${meta.model} prompt=${meta.promptVersion} ` +
      `time=${meta.latencyMs}ms attempts=${meta.attempts} retries=${meta.retryCount} ` +
      `validation=${meta.validationStatus} tokens=${meta.inputTokens ?? "-"}/${meta.outputTokens ?? "-"}`
  );
}
