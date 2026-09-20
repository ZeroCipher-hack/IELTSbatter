import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { computeFullExamOverall, weakestFullExamModules } from "@/lib/full-exam/scoring";
describe("full IELTS exam scoring", () => {
  it("uses all four modules and official half-band rounding", () => {
    expect(computeFullExamOverall({ listening: 7, reading: 6.5, writing: 6, speaking: 6.5 })).toBe(6.5);
    expect(computeFullExamOverall({ listening: 7, reading: 7, writing: 6.5, speaking: 6.5 })).toBe(7);
    expect(computeFullExamOverall({ listening: 6, reading: 6, writing: 6, speaking: 7 })).toBe(6.5);
  });
  it("normalizes component precision", () => { expect(computeFullExamOverall({ listening: 9.7, reading: 6.26, writing: 5.74, speaking: -1 })).toBe(5.5); });
  it("reports tied weakest modules", () => { expect(weakestFullExamModules({ listening: 7, reading: 6, writing: 6, speaking: 6.5 })).toEqual(["reading", "writing"]); });
  it("enforces ownership and one active session in the migration", () => { const migration = fs.readFileSync("prisma/migrations/20260920000000_full_exam_sessions/migration.sql", "utf8"); expect(migration).toContain('REFERENCES "User"("id") ON DELETE CASCADE'); expect(migration).toContain('"FullExamSession_one_active_per_user"'); });
  it("never completes a partial exam", () => { const service = fs.readFileSync("src/lib/full-exam/service.ts", "utf8"); expect(service).toContain('Object.values(components).every((item) => item.status === "COMPLETED"'); expect(service).toContain("where: { id: sessionId, userId }"); });
});
