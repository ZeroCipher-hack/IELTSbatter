/**
 * Small presentation helpers shared by the test UIs.
 * No environment access, no side effects — safe to use in any component.
 */
import type { AnswerValue } from "@/lib/testing/types";

/** Human-readable form of a learner's answer (arrays joined, null -> ""). */
export function publicAnswerLabel(value: AnswerValue): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.filter((item) => item.trim().length > 0).join(", ");
  return value.trim();
}
