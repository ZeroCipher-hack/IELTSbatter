import { WRITING_GRADING_PROMPT_VERSION } from "./prompts";
import {
  writingGradingResponseSchema,
  type AIGrader,
  type WritingGradingInput,
  type WritingGradingResult,
} from "./schema";
import { computeOverall, countWords } from "@/lib/utils/scoring";

/**
 * Deterministic mock grader.
 *
 * Used when AI_MODE=mock (no Gemini API key) and in automated tests.
 * Produces stable, essay-length-dependent scores so the full
 * submit → grade → store → result flow can be exercised end to end.
 */
export class MockGrader implements AIGrader {
  readonly provider = "mock";
  readonly model = "mock-grader-1";

  async gradeWriting(input: WritingGradingInput): Promise<WritingGradingResult> {
    const words = countWords(input.essay);
    // Deterministic pseudo-variation from essay content.
    const seed = hashString(input.essay) % 4; // 0..3
    const base = words < 150 ? 4.5 : words < 250 ? 5.5 : 6.0;

    const scores = {
      taskResponse: clampBand(base + (seed === 0 ? 0.5 : 0)),
      coherenceCohesion: clampBand(base + (seed === 1 ? 0.5 : 0)),
      lexicalResource: clampBand(base + (seed === 2 ? 0.5 : 0)),
      grammar: clampBand(base + (seed === 3 ? 0.5 : 0)),
    };

    const uz = input.feedbackLocale !== "ru";
    const firstSentence = input.essay.split(/(?<=[.!?])\s+/)[0]?.slice(0, 160) ?? "";

    const data = writingGradingResponseSchema.parse({
      scores: {
        taskResponse: {
          band: scores.taskResponse,
          note: uz
            ? `Mock baholash: esse ${words} so'zdan iborat. Savolga umumiy javob berilgan, lekin bu demo natija — haqiqiy AI baholash uchun GEMINI_API_KEY sozlang.`
            : `Мок-оценка: эссе содержит ${words} слов. Это демо-результат — настройте GEMINI_API_KEY для реальной оценки ИИ.`,
        },
        coherenceCohesion: {
          band: scores.coherenceCohesion,
          note: uz
            ? "Mock baholash: paragraf tuzilmasi aniqlangan. Bu demo natija."
            : "Мок-оценка: структура абзацев определена. Это демо-результат.",
        },
        lexicalResource: {
          band: scores.lexicalResource,
          note: uz
            ? "Mock baholash: lug'at boyligi o'rtacha deb belgilandi. Bu demo natija."
            : "Мок-оценка: словарный запас отмечен как средний. Это демо-результат.",
        },
        grammar: {
          band: scores.grammar,
          note: uz
            ? "Mock baholash: grammatik diapazon o'rtacha deb belgilandi. Bu demo natija."
            : "Мок-оценка: грамматический диапазон отмечен как средний. Это демо-результат.",
        },
      },
      summary: uz
        ? `Bu mock (demo) baholash natijasi. Esse ${words} so'zdan iborat. Real IELTS baholash uchun .env faylida AI_MODE=gemini va GEMINI_API_KEY ni sozlang.`
        : `Это мок-результат (демо). Эссе содержит ${words} слов. Для реальной оценки IELTS настройте AI_MODE=gemini и GEMINI_API_KEY в .env.`,
      strengths: uz
        ? ["Esse topshirildi va tizim to'liq ishladi", "So'z soni: " + words]
        : ["Эссе отправлено, система отработала полностью", "Количество слов: " + words],
      weaknesses: uz
        ? ["Bu demo baholash — haqiqiy tahlil emas"]
        : ["Это демо-оценка, а не реальный анализ"],
      improvements: uz
        ? ["GEMINI_API_KEY sozlang va qayta topshiring"]
        : ["Настройте GEMINI_API_KEY и отправьте снова"],
      errors: firstSentence
        ? [
            {
              category: "style",
              originalText: firstSentence,
              correction: firstSentence,
              explanation: uz
                ? "Mock rejim: bu haqiqiy xato emas, tizim namoyishi uchun ko'rsatilgan."
                : "Мок-режим: это не реальная ошибка, показано для демонстрации системы.",
            },
          ]
        : [],
    });

    return {
      data,
      overall: computeOverall(scores),
      meta: {
        provider: this.provider,
        model: this.model,
        promptVersion: WRITING_GRADING_PROMPT_VERSION,
        rawResponse: JSON.stringify(data),
        latencyMs: 0,
      },
    };
  }
}

function clampBand(v: number): number {
  return Math.min(9, Math.max(0, Math.round(v * 2) / 2));
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
