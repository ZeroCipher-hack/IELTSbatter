import { describe, it, expect } from "vitest";
import { computeOverall, normalizeBand, countWords } from "@/lib/utils/scoring";

describe("normalizeBand", () => {
  it("snaps to 0.5 steps", () => {
    expect(normalizeBand(6.3)).toBe(6.5);
    expect(normalizeBand(6.2)).toBe(6.0);
    expect(normalizeBand(6.75)).toBe(7.0);
  });

  it("clamps to [0, 9]", () => {
    expect(normalizeBand(-1)).toBe(0);
    expect(normalizeBand(10)).toBe(9);
  });
});

describe("computeOverall (IELTS rounding)", () => {
  it("returns exact mean when already a 0.5 step", () => {
    expect(
      computeOverall({ taskResponse: 6, coherenceCohesion: 6, lexicalResource: 6, grammar: 6 })
    ).toBe(6.0);
    expect(
      computeOverall({ taskResponse: 7, coherenceCohesion: 6, lexicalResource: 7, grammar: 6 })
    ).toBe(6.5);
  });

  it("rounds .25 mean UP to the next half band (official IELTS rule)", () => {
    // (6.5 + 6 + 6 + 6.5) / 4 = 6.25 -> 6.5
    expect(
      computeOverall({ taskResponse: 6.5, coherenceCohesion: 6, lexicalResource: 6, grammar: 6.5 })
    ).toBe(6.5);
  });

  it("rounds .75 mean UP", () => {
    // (7 + 7 + 6.5 + 6.5) / 4 = 6.75 -> 7.0
    expect(
      computeOverall({ taskResponse: 7, coherenceCohesion: 7, lexicalResource: 6.5, grammar: 6.5 })
    ).toBe(7.0);
  });

  it("handles .125 style means", () => {
    // (6.5 + 6 + 6 + 6) / 4 = 6.125 -> 6.0 (below midpoint of 6.0-6.5)
    expect(
      computeOverall({ taskResponse: 6.5, coherenceCohesion: 6, lexicalResource: 6, grammar: 6 })
    ).toBe(6.0);
    // (6.5 + 6.5 + 6.5 + 6) / 4 = 6.375 -> 6.5 (above midpoint)
    expect(
      computeOverall({ taskResponse: 6.5, coherenceCohesion: 6.5, lexicalResource: 6.5, grammar: 6 })
    ).toBe(6.5);
  });
});

describe("countWords", () => {
  it("counts words separated by any whitespace", () => {
    expect(countWords("one two   three\nfour")).toBe(4);
    expect(countWords("   ")).toBe(0);
    expect(countWords("")).toBe(0);
  });
});
