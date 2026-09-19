export type InterviewState =
  | "PREPARING" | "PART_1" | "PART_2" | "PART_3" | "UPLOADING"
  | "TRANSCRIBING" | "EVALUATING" | "COMPLETED" | "FAILED";

export type TransitionDecision =
  | { kind: "APPLY"; next: InterviewState }
  | { kind: "IDEMPOTENT" }
  | { kind: "REJECT"; code: "invalid_transition" | "timer_not_elapsed" | "interview_expired" };

export function decideBeginPart(state: InterviewState, part: number, remainingSeconds: number): TransitionDecision {
  const expected = `PART_${part}` as InterviewState;
  if (state === expected) return { kind: "IDEMPOTENT" };
  if (state === "FAILED") return { kind: "REJECT", code: "interview_expired" };
  if (state !== "PREPARING") return { kind: "REJECT", code: "invalid_transition" };
  if (remainingSeconds > 0) return { kind: "REJECT", code: "timer_not_elapsed" };
  return { kind: "APPLY", next: expected };
}

export function timerRemaining(startedAt: Date, durationSeconds: number, now: Date): number {
  const elapsed = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
  return Math.max(0, durationSeconds - elapsed);
}

export function partTimerSeconds(
  prompts: Array<{ part: number; preparationSeconds: number; speakingSeconds: number }>,
  part: number,
  phase: "PREPARING" | "SPEAKING"
): number {
  const inPart = prompts.filter((prompt) => prompt.part === part);
  return phase === "PREPARING"
    ? inPart.reduce((longest, prompt) => Math.max(longest, prompt.preparationSeconds), 0)
    : inPart.reduce((total, prompt) => total + prompt.speakingSeconds, 0);
}
