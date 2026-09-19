import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";

describe("post-auth redirect safety", () => {
  it("keeps valid same-origin paths", () => {
    expect(safeNextPath("/reading/test-1?resume=1")).toBe("/reading/test-1?resume=1");
  });

  it.each([null, "", "https://evil.example", "//evil.example", "/\\evil.example"])(
    "rejects external or malformed next target %s",
    (target) => {
      expect(safeNextPath(target)).toBe("/dashboard");
    }
  );
});
