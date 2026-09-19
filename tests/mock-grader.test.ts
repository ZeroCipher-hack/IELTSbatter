import { describe, it, expect } from "vitest";
import { MockGrader } from "@/lib/ai/mock";
import { writingGradingResponseSchema } from "@/lib/ai/schema";
import { computeOverall } from "@/lib/utils/scoring";

const essay = Array(260).fill("word").join(" ");

describe("MockGrader (deterministic AI provider for tests)", () => {
  it("returns a schema-valid response", async () => {
    const grader = new MockGrader();
    const result = await grader.gradeWriting({
      question: "Discuss both views and give your opinion.",
      essay,
      feedbackLocale: "uz",
    });
    expect(writingGradingResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it("is deterministic for the same essay", async () => {
    const grader = new MockGrader();
    const a = await grader.gradeWriting({ question: "Q", essay, feedbackLocale: "uz" });
    const b = await grader.gradeWriting({ question: "Q", essay, feedbackLocale: "uz" });
    expect(a.data.scores).toEqual(b.data.scores);
    expect(a.overall).toBe(b.overall);
  });

  it("computes overall from criterion scores server-side", async () => {
    const grader = new MockGrader();
    const r = await grader.gradeWriting({ question: "Q", essay, feedbackLocale: "uz" });
    expect(r.overall).toBe(
      computeOverall({
        taskResponse: r.data.scores.taskResponse.band,
        coherenceCohesion: r.data.scores.coherenceCohesion.band,
        lexicalResource: r.data.scores.lexicalResource.band,
        grammar: r.data.scores.grammar.band,
      })
    );
  });

  it("penalises very short essays", async () => {
    const grader = new MockGrader();
    const short = await grader.gradeWriting({
      question: "Q",
      essay: "only a few words here",
      feedbackLocale: "uz",
    });
    const long = await grader.gradeWriting({ question: "Q", essay, feedbackLocale: "uz" });
    expect(short.data.scores.taskResponse.band).toBeLessThan(long.data.scores.taskResponse.band);
  });
});
