/**
 * Tolerant JSON extraction for LLM responses.
 * Models sometimes wrap JSON in markdown fences or add stray text.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();

  // 1. Direct parse.
  try {
    return JSON.parse(trimmed);
  } catch {
    /* continue */
  }

  // 2. Strip markdown fences.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* continue */
    }
  }

  // 3. First '{' to last '}'.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* continue */
    }
  }

  throw new Error("Response did not contain valid JSON");
}
