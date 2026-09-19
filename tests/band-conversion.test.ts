import { describe, it, expect } from "vitest";
import {
  bandForRaw,
  normalizeBand,
  rawToBand,
  resolveBandTable,
  scorePercentage,
  READING_BAND_TABLE,
  LISTENING_BAND_TABLE,
} from "@/lib/testing/band-conversion";

describe("rawToBand", () => {
  it("maps a full 40-question paper using the table", () => {
    expect(rawToBand("READING", 40, 40)).toBe(9.0);
    expect(rawToBand("READING", 39, 40)).toBe(9.0);
    expect(rawToBand("READING", 30, 40)).toBe(7.0);
    expect(rawToBand("READING", 23, 40)).toBe(6.0);
    expect(rawToBand("READING", 0, 40)).toBe(0);
  });

  it("uses the listening table for listening", () => {
    expect(rawToBand("LISTENING", 32, 40)).toBe(7.5);
    expect(rawToBand("LISTENING", 30, 40)).toBe(7.0);
    expect(rawToBand("LISTENING", 26, 40)).toBe(6.5);
    expect(rawToBand("LISTENING", 18, 40)).toBe(5.5);
  });

  it("scales short practice papers to the /40 table", () => {
    // 13/14 correct ~= 37/40 -> 8.5
    expect(rawToBand("READING", 13, 14)).toBe(8.5);
    // 7/14 correct = 20/40 -> 5.5
    expect(rawToBand("READING", 7, 14)).toBe(5.5);
    // 12 questions, all correct -> 40/40 -> 9.0
    expect(rawToBand("LISTENING", 12, 12)).toBe(9.0);
  });

  it("clamps impossible input", () => {
    expect(rawToBand("READING", 50, 40)).toBe(9.0);
    expect(rawToBand("READING", -3, 40)).toBe(0);
    expect(rawToBand("READING", 5, 0)).toBe(0);
  });

  it("is monotonic: more correct answers never give a lower band", () => {
    let previous = -1;
    for (let raw = 0; raw <= 40; raw++) {
      const band = rawToBand("READING", raw, 40);
      expect(band).toBeGreaterThanOrEqual(previous);
      previous = band;
    }
  });

  it("always returns a 0.5 step between 0 and 9", () => {
    for (const module of ["READING", "LISTENING"] as const) {
      for (let raw = 0; raw <= 40; raw++) {
        const band = rawToBand(module, raw, 40);
        expect(Number.isInteger(band * 2)).toBe(true);
        expect(band).toBeGreaterThanOrEqual(0);
        expect(band).toBeLessThanOrEqual(9);
      }
    }
  });
});

describe("bandForRaw", () => {
  it("picks the highest threshold that the score reaches", () => {
    expect(bandForRaw("READING", 38)).toBe(8.5);
    expect(bandForRaw("READING", 36)).toBe(8.0);
    expect(bandForRaw("READING", 1)).toBe(1.0);
  });

  it("rounds fractional raw scores", () => {
    expect(bandForRaw("READING", 36.6)).toBe(8.5);
    expect(bandForRaw("READING", 36.4)).toBe(8.0);
  });
});

describe("tables", () => {
  it("are ordered from the highest threshold down", () => {
    for (const table of [READING_BAND_TABLE, LISTENING_BAND_TABLE]) {
      for (let i = 1; i < table.length; i++) {
        expect(table[i].min).toBeLessThan(table[i - 1].min);
      }
      expect(table[table.length - 1].min).toBe(0);
    }
  });
});

describe("resolveBandTable (configurable mapping)", () => {
  it("uses a valid JSON override for the requested module", () => {
    const override = JSON.stringify({
      READING: [
        { min: 10, band: 8 },
        { min: 0, band: 2 },
      ],
    });
    const table = resolveBandTable("READING", override);
    expect(rawToBand("READING", 10, 40, table)).toBe(8);
    expect(rawToBand("READING", 5, 40, table)).toBe(2);
  });

  it("falls back to the default table when the override is malformed", () => {
    expect(resolveBandTable("READING", "{not json")).toBe(READING_BAND_TABLE);
    expect(resolveBandTable("READING", JSON.stringify({ LISTENING: [{ min: 0, band: 9 }] }))).toBe(
      READING_BAND_TABLE
    );
    expect(resolveBandTable("READING", JSON.stringify({ READING: [] }))).toBe(READING_BAND_TABLE);
    expect(resolveBandTable("READING", null)).toBe(READING_BAND_TABLE);
  });
});

describe("helpers", () => {
  it("normalizeBand clamps to 0-9 in 0.5 steps", () => {
    expect(normalizeBand(8.4)).toBe(8.5);
    expect(normalizeBand(12)).toBe(9);
    expect(normalizeBand(-1)).toBe(0);
  });

  it("scorePercentage rounds sensibly and never divides by zero", () => {
    expect(scorePercentage(13, 14)).toBe(93);
    expect(scorePercentage(0, 14)).toBe(0);
    expect(scorePercentage(5, 0)).toBe(0);
  });
});
