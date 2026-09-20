export type ExaminerIntent = "REPEAT_QUESTION" | "READY" | "NONE";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z\s']/g, " ").replace(/\s+/g, " ").trim();

export function classifyExaminerIntent(transcript: string): ExaminerIntent {
  const text = normalize(transcript);
  if (!text) return "NONE";
  if (/\b(repeat|say (that|it) again|once more|pardon)\b/.test(text)) return "REPEAT_QUESTION";
  if (/\b(i am ready|i'm ready|ready to (start|begin)|let's (start|begin))\b/.test(text)) return "READY";
  return "NONE";
}

export function buildRepeatSpeech(question: string): string {
  return `Of course. ${question}`;
}

export function canListenForExaminerCommands(state: string): boolean {
  return state === "PREPARING" || state.startsWith("PART_");
}
