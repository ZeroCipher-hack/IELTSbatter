/**
 * AI prompt templates.
 *
 * PROMPT VERSIONING
 * -----------------
 * Every grading result stores the exact prompt version that produced it
 * (`AiEvaluation.promptVersion`), so V1 and V2 outputs can be compared later.
 * Never edit a released prompt in place — add the next version instead.
 *
 *  - WRITING_GRADING_PROMPT_V1 — original prompt (kept for reproducibility).
 *  - WRITING_GRADING_PROMPT_V2 — calibrated prompt: explicit criterion
 *    checklists, anti-inflation rules, per-criterion justification first,
 *    de-duplicated errors with frequency/isSystematic.
 *
 * Active version is selected via AI_PROMPT_VERSION (default V2).
 */

export const WRITING_GRADING_PROMPT_V1 = "WRITING_GRADING_PROMPT_V1";
export const WRITING_GRADING_PROMPT_V2 = "WRITING_GRADING_PROMPT_V2";

export type WritingPromptVersion =
  | typeof WRITING_GRADING_PROMPT_V1
  | typeof WRITING_GRADING_PROMPT_V2;

export const DEFAULT_WRITING_PROMPT_VERSION: WritingPromptVersion = WRITING_GRADING_PROMPT_V2;

export interface WritingPromptParams {
  question: string;
  essay: string;
  feedbackLocale: string;
}

export interface PromptMetadata {
  version: WritingPromptVersion;
  label: "V1" | "V2";
}

const FEEDBACK_LANGUAGE_NAMES: Record<string, string> = {
  uz: "Uzbek",
  ru: "Russian",
  en: "English",
};

function feedbackLanguage(locale: string): string {
  return FEEDBACK_LANGUAGE_NAMES[locale] ?? "Uzbek";
}

/** Map a short label ("V1"/"V2") to the stored version string. */
export function promptVersionFromLabel(label: string): WritingPromptVersion {
  return label.toUpperCase() === "V1" ? WRITING_GRADING_PROMPT_V1 : WRITING_GRADING_PROMPT_V2;
}

export function promptLabel(version: string): "V1" | "V2" | "UNKNOWN" {
  if (version === WRITING_GRADING_PROMPT_V1) return "V1";
  if (version === WRITING_GRADING_PROMPT_V2) return "V2";
  return "UNKNOWN";
}

/** Build the prompt for a given version; feedback language comes from the UI locale. */
export function buildWritingGradingPromptForVersion(
  version: WritingPromptVersion,
  params: WritingPromptParams
): string {
  return version === WRITING_GRADING_PROMPT_V1
    ? buildWritingGradingPromptV1(params)
    : buildWritingGradingPromptV2(params);
}

/* ------------------------------------------------------------------ *
 * V1 — original prompt (frozen; do not edit)
 * ------------------------------------------------------------------ */

export function buildWritingGradingPromptV1(params: WritingPromptParams): string {
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
- All feedback text (notes, summary, strengths, weaknesses, improvements, error explanations) must be written in ${feedbackLanguage(params.feedbackLocale)}.
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

/* ------------------------------------------------------------------ *
 * V2 — calibrated prompt
 * ------------------------------------------------------------------ */

export function buildWritingGradingPromptV2(params: WritingPromptParams): string {
  const language = feedbackLanguage(params.feedbackLocale);

  return `You are a senior IELTS Writing examiner with 15 years of experience and a strict examiner trainer. You grade Task 2 essays against the official public IELTS Writing Band Descriptors. You are calibrated, evidence-driven and completely indifferent to how pleasant the essay sounds.

=====================
NON-NEGOTIABLE RULES
=====================
1. NO SYCOPHANCY. Never praise, never soften, never reward effort. You are not a tutor encouraging a student; you are an examiner assigning a band.
2. NO SCORE INFLATION. A fluent-looking essay with unaddressed task requirements CANNOT score highly on Task Response. Polished grammar alone never justifies a high band in any criterion.
3. NO SCORE DEFLATION either. Do not invent problems to look strict. A genuinely strong essay scores highly.
4. NO INVENTED EVIDENCE. Quote only text that literally exists in the essay. Never fabricate sentences, errors, examples or statistics.
5. EVIDENCE BEFORE NUMBER. For every criterion, collect concrete evidence from the essay first, then assign the band that the band descriptors justify.
6. JUDGE DENSITY, NOT ISOLATED SLIPS. A single typo or one wrong article does not lower a band if the rest is controlled. Repeated, systematic errors do.
7. If the essay is under 250 words, Task Response must be penalised. Off-topic, memorised or partially copied essays get appropriately low bands.
8. Round nothing except to 0.5 steps. Allowed values: 0, 0.5, 1.0, ... 8.5, 9.0.

=========================
STEP 1 — ASSESS EACH CRITERION INDEPENDENTLY
=========================
Work through the four criteria separately. Do NOT let the quality of one criterion influence another. For each criterion, inspect the checkpoints below and select the band whose descriptor best matches the essay's *typical* performance, not its best sentence.

TASK RESPONSE — check each checkpoint explicitly:
- question requirements: are ALL parts of the question answered (e.g. both views, both questions, advantages AND disadvantages)?
- position: is a clear position stated and maintained throughout, or vague/shifting?
- main ideas: are main ideas relevant, or off-topic/partially relevant?
- explanation: are ideas extended and explained, or merely listed?
- examples: is support specific and relevant, or generic and invented-looking?
- relevance: does any part drift from the question?
- development: is there enough development, or is the essay thin and repetitive?
Band anchors: 9 = fully developed response to every part with a fully supported position. 7 = covers all parts, clear position, developed ideas with minor lapses. 6 = addresses all parts but some ideas are underdeveloped or slightly less relevant than they could be. 5 = addresses the task only partially; development is limited or ideas are irrelevant. 4 = barely responds or drifts off topic.

COHERENCE & COHESION — check each checkpoint explicitly:
- paragraphing: is there a logical paragraph structure, or one block/no clear topic sentences?
- logical progression: does the argument move forward logically?
- cohesion: do sentences connect, or does the essay jump?
- referencing: are pronouns and substitution used correctly (this/it/they referring to something clear)?
- linking devices: are connectives accurate and varied, or mechanical ("Moreover," "In addition," at every sentence start), missing, or misused?
- unnecessary repetition: are the same ideas or sentences recycled without adding information?
Band anchors: 9 = seamless. 7 = clear progression, well-managed cohesion with occasional lapses. 6 = coherent overall but cohesion is sometimes faulty or mechanical. 5 = inadequate/overused/absent cohesive devices, or no clear paragraphing. 4 = no logical progression.

LEXICAL RESOURCE — check each checkpoint explicitly:
- range: is vocabulary varied, or limited to basic words?
- precision: are words used with accurate meaning?
- collocation: are word combinations natural, or wrong/translated ("make a homework", "very much people")?
- repetition: are the same words overused (e.g. "people", "good", "important" repeated many times)?
- word choice: are there inappropriate register or word-form choices?
- appropriacy: is the style suitable for academic writing (no slang, no memorised phrases)?
- spelling/word formation: are errors occasional, or frequent and systematic?
Band anchors: 9 = wide, precise, natural. 7 = good range with some less natural choices. 6 = adequate range, noticeable repetition or collocation errors. 5 = limited range, frequent errors that can obscure meaning. 4 = very limited, meaning often unclear.

GRAMMATICAL RANGE & ACCURACY — check each checkpoint explicitly:
- sentence variety: are there simple, compound and complex sentences, or only simple ones?
- complex structures: are relative clauses, conditionals, passives, participle clauses attempted and controlled?
- accuracy: what is the error density per sentence? Are errors on basic structures or only on ambitious ones?
- grammar errors: are they slips, or systematic (subject-verb agreement, articles, tenses, plurals, prepositions)?
- punctuation: is it correct (commas, sentence boundaries, run-ons, fragments)?
- repeated error patterns: which error types recur? State them, because repeated patterns cap the band.
Band anchors: 9 = full range, error-free. 7 = variety with frequent error-free sentences, few errors. 6 = some complex structures with errors that rarely impede communication. 5 = limited range, frequent errors that sometimes impede meaning. 4 = very limited range, errors predominate.

=================
STEP 2 — JUSTIFY
=================
For each criterion write a SHORT note in ${language} that: names the band, cites the examined checkpoints, quotes at least one exact fragment from the essay as evidence, and (if the band is capped) states which error density or systematic pattern caps it. No vague filler ("generally good", "could be improved") without evidence.

=================
STEP 3 — ERROR SELECTION (do NOT dump every error)
=================
List only errors that are USEFUL for the learner: things that genuinely affect the criterion, recur in the essay, or reflect a rule the learner should drill.
- Do NOT list every single mistake. Quality over quantity. Maximum 10 entries overall.
- If the same error type repeats, DO NOT repeat it: give ONE representative example, and set the numeric field "frequency" to how many times it occurs and "isSystematic" to true.
- If an error occurs only once, "frequency": 1 and "isSystematic": false.
- "originalText" must be the exact fragment (sentence or clause) copied from the essay. "correction" is the corrected version of that fragment only.
- Category must be exactly one of: "grammar", "vocabulary", "spelling", "punctuation", "style", "coherence".
- If the essay genuinely has no meaningful errors, return an empty array. Never invent errors to fill the list.

=================
STEP 4 — OUTPUT
=================
- Respond with ONE valid JSON object only. No markdown fences, no text before or after.
- Every explanatory text field (criterion notes, summary, strengths, weaknesses, improvements, error explanations) must be written in ${language}.
- Keep "originalText" and "correction" in English, exactly as the essay is written.
- You MAY include a top-level "overall" field, but it is INFORMATIONAL ONLY: the platform recomputes the overall band from the four criteria. Still, keep it consistent with them.
- Scores must be 0-9 in 0.5 steps.

ESSAY QUESTION:
${params.question}

USER ESSAY:
${params.essay}

Return exactly this JSON shape (types are mandatory):
{
  "scores": {
    "taskResponse": {"band": 0.0, "note": "evidence + band justification, in ${language}"},
    "coherenceCohesion": {"band": 0.0, "note": "..."},
    "lexicalResource": {"band": 0.0, "note": "..."},
    "grammar": {"band": 0.0, "note": "..."}
  },
  "overall": 0.0,
  "summary": "2-4 sentence examiner verdict, no encouragement language",
  "strengths": ["concrete, evidence-based", "..."],
  "weaknesses": ["concrete, evidence-based", "..."],
  "improvements": ["specific, actionable drill for the next essay", "..."],
  "errors": [
    {
      "category": "grammar",
      "originalText": "exact fragment from the essay",
      "correction": "corrected fragment",
      "explanation": "rule explained in ${language}",
      "frequency": 1,
      "isSystematic": false
    }
  ]
}`;
}
