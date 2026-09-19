import { describe, it, expect } from "vitest";
import { extractJson } from "@/lib/ai/json";

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("parses JSON with surrounding prose", () => {
    expect(extractJson('Here is the result:\n{"a": 1}\nThanks!')).toEqual({ a: 1 });
  });

  it("throws on garbage", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
