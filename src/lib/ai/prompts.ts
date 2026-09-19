/**
 * AI prompt templates. Bump the version string whenever the prompt changes —
 * it is stored with every AiEvaluation row for later comparison.
 */

export const WRITING_GRADING_PROMPT_VERSION = "WRITING_GRADING_PROMPT_V1";

const FEEDBACK_LANGUAGE_NAMES: Record<string, string> = {
  uz: "Uzbek",
  ru: "Russian",
  en: "English",
};

export function buildWritingGradingPrompt(params: {
  question: string;
  essay: string;
  feedbackLocale: string;
}): string {
  const feedbackLanguage = FEEDBACK_LANGUAGE_NAMES[params.feedbackLocale] ?? "Uzbek";

  return `You are an experienced, certified IELTS Writing examiner. Grade the essay below strictly and consistently against the official IELTS Writing Task 2 Band Descriptors.

GRADING CRITERIA:

1. Task Response: Does the essay answer the question? Are all parts of the task covered? Is the position clear and consistent? Are ideas developed and supported with relevant examples?
2. Coherence and Cohesion: Paragraph structure, logical progression, linking devices, referencing, overall cohesion.
3. Lexical Resource: Vocabulary range, precision, appropriacy, repetition, collocations, word formation.
4. Grammatical Range and Accuracy: Variety of sentence structures, grammatical range, error density, accuracy, punctuation.

CALIBRATION RULES:
- Score each criterion 0-9 in 0.5 steps (e.g. 5.0, 5.5, 6.0).
- IELTS grading is based on overall impression. One or two isolated slips must NOT block a high band if the rest is consistently strong. Distinguish "single occurrence" errors from "systematic, repeated" errors: only error DENSITY and SYSTEMATIC patterns lower a band.
- Do not inflate scores to be kind. Do not deflate scores to seem strict. A weak essay gets a low band; a strong essay gets a high band.
- Base every judgement ONLY on evidence in the essay. Never invent facts, sentences or errors that are not present.
- Quote exact sentences/phrases from the essay in your notes and error list.
- If the essay is under 250 words, penalise Task Response accordingly.
- If the essay is off-topic, memorised, or not a genuine attempt, give appropriately low scores.

OUTPUT RULES:
- Respond with ONE valid JSON object only. No markdown fences, no commentary, nothing outside the JSON.
- All feedback text (notes, summary, strengths, weaknesses, improvements, error explanations) must be written in ${feedbackLanguage}.
- Keep quoted essay fragments ("originalText", "correction") in English exactly as they appear in the essay.
- "errors": list the most important concrete errors (max 15), each with the exact original sentence, the problem, and a corrected version.

ESSAY QUESTION:
${params.question}

USER ESSAY:
${params.essay}

Return exactly this JSON shape:
{
  "scores": {
    "taskResponse": {"band": 0.0, "note": "why, with exact quotes"},
    "coherenceCohesion": {"band": 0.0, "note": "..."},
    "lexicalResource": {"band": 0.0, "note": "..."},
    "grammar": {"band": 0.0, "note": "..."}
  },
  "summary": "2-4 sentence overall assessment",
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "improvements": ["specific, actionable next steps"],
  "errors": [
    {"category": "grammar", "originalText": "exact sentence from essay", "correction": "fixed sentence", "explanation": "what was wrong"}
  ]
}`;
}
