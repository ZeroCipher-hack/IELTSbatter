import { describe, it, expect } from "vitest";
import { sanitizeAiText, summarizeError } from "@/lib/ai/sanitize";

const KEY = "AIzaSyD-EXAMPLE-KEY-1234567890";

describe("sanitizeAiText", () => {
  it("redacts Google API keys wherever they appear", () => {
    expect(sanitizeAiText(`API key not valid: ${KEY}`)).toBe("API key not valid: [redacted]");
    expect(sanitizeAiText(`{"apiKey":"${KEY}"}`)).not.toContain(KEY);
    expect(sanitizeAiText(`before ${KEY} after`)).toBe("before [redacted] after");
  });

  it("keeps a diagnosable prefix", () => {
    expect(
      sanitizeAiText("https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=" + KEY)
    ).toContain("?key=[redacted]");
  });

  it("redacts bearer tokens and named secrets", () => {
    expect(sanitizeAiText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toContain("[redacted]");
    expect(sanitizeAiText("password=hunter2secret")).toBe("password=[redacted]");
  });

  it("leaves ordinary text untouched", () => {
    const text = "Task Response band 6.5 — clear position but underdeveloped examples.";
    expect(sanitizeAiText(text)).toBe(text);
  });

  it("summarizeError never returns the raw key and stays short", () => {
    const summary = summarizeError(new Error(`boom ${KEY} ${"x".repeat(2000)}`));
    expect(summary).not.toContain(KEY);
    expect(summary.length).toBeLessThanOrEqual(500);
  });
});
