import { createHash } from "node:crypto";
import type { WritingSubmissionInput } from "@/lib/validations/writing";

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

export function parseIdempotencyKey(value: string | null): string | null {
  if (value == null) return null;
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) throw new InvalidIdempotencyKeyError();
  return value;
}

export function writingRequestFingerprint(input: WritingSubmissionInput, locale: string): string {
  return createHash("sha256")
    .update(JSON.stringify({
      essay: input.essay,
      question: input.question,
      testType: input.testType,
      locale,
    }))
    .digest("hex");
}

export class InvalidIdempotencyKeyError extends Error {
  constructor() { super("invalid_idempotency_key"); }
}

export class IdempotencyConflictError extends Error {
  constructor() { super("idempotency_key_reused_with_different_payload"); }
}
