import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import uz from "../messages/uz.json";
import ru from "../messages/ru.json";
import { buildContentSecurityPolicy } from "../src/lib/security/csp";

describe("workspace header translations", () => {
  for (const [locale, messages] of Object.entries({ uz, ru })) {
    it(`resolves every literal Header common key in ${locale}`, () => {
      const errors: unknown[] = [];
      const t = createTranslator({ locale, messages, namespace: "common", onError: error => errors.push(error) });
      const header = readFileSync("src/components/layout/Header.tsx", "utf8");
      const keys = [...header.matchAll(/\bt\("([^"]+)"\)/g)].map(match => match[1]);
      expect(keys).toContain("home");
      for (const key of keys) {
        t(key as Parameters<typeof t>[0]);
      }
      expect(errors).toEqual([]);
    });
  }
});

describe("3D examiner resource policy", () => {
  it("allows local blob texture fetches without allowing blob scripts", () => {
    const policy = buildContentSecurityPolicy("0123456789abcdef0123456789abcdef");
    const directives = policy.split("; ");
    expect(directives.find(value => value.startsWith("connect-src "))?.split(" ")).toContain("blob:");
    expect(directives.find(value => value.startsWith("script-src "))?.split(" ")).not.toContain("blob:");
    expect(directives).toContain("object-src 'none'");
    expect(directives).toContain("report-uri /api/security/csp-report");
  });
});
