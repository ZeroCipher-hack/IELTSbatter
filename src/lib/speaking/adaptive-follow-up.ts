export function buildAdaptiveFollowUp(part: number, transcript: string): string | null {
  const answer = transcript.trim().replace(/\s+/g, " ");
  if (part === 2 || answer.split(" ").filter(Boolean).length < 5) return null;
  const lower = answer.toLowerCase();

  if (part === 1) {
    if (/\b(work|job|study|school|university|college)\b/.test(lower)) return "What do you enjoy most about that?";
    if (/\b(live|city|town|village|home|place)\b/.test(lower)) return "What do you like most about living there?";
    if (/\b(hobby|free time|sport|music|read|game)\b/.test(lower)) return "Why is that activity important to you?";
    return "Could you tell me a little more about that?";
  }

  if (/\b(governments?|authority|public sector)\b/.test(lower)) return "What responsibility should governments have in this area?";
  if (/\b(future|technology|internet|artificial intelligence| ai )\b/.test(` ${lower} `)) return "How do you think this might change in the future?";
  if (/\b(because|i think|in my opinion|i believe)\b/.test(lower)) return "What is the strongest argument against that point of view?";
  return "How might this issue affect society as a whole?";
}
