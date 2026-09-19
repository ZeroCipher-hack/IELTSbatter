/**
 * Static security guards (requirement 11). These are cheap regression tests
 * that fail if someone later leaks the AI provider into client code, hardcodes
 * a key, uses raw SQL, or un-ignores `.env`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const sourceFiles = walk(SRC);
const read = (file: string) => fs.readFileSync(file, "utf8");
const rel = (file: string) => path.relative(ROOT, file);

describe("AI provider isolation", () => {
  it("imports the Gemini SDK only from the two provider files", () => {
    const importers = sourceFiles.filter((f) => read(f).includes("@google/generative-ai"));
    // One file per pipeline half: writing grading and speaking (transcription +
    // evaluation). Nothing else in the app may touch the SDK.
    expect(importers.map(rel).sort()).toEqual([
      "src/lib/ai/gemini.ts",
      "src/lib/ai/speaking/gemini.ts",
    ]);
  });

  it("never imports lib/ai from a client component", () => {
    const offenders = sourceFiles
      .filter((f) => f.includes(`${path.sep}components${path.sep}`) || read(f).startsWith('"use client"'))
      .filter((f) => /from\s+"@\/lib\/ai/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("reaches providers only through the grading factory (no direct gemini/mock/prompts imports)", () => {
    // Scripts (calibration tooling) may import providers directly; app code may not.
    const wrongDoor = sourceFiles
      .filter((f) => !f.includes(`${path.sep}lib${path.sep}ai${path.sep}`))
      .filter((f) =>
        /from\s+"@\/lib\/ai\/(gemini|mock|prompts|speaking\/(gemini|mock))"/.test(read(f))
      );

    expect(wrongDoor.map(rel)).toEqual([]);

    // The one place allowed to build a provider is the factory itself.
    const factory = path.join(SRC, "lib", "ai", "grading.ts");
    expect(read(factory)).toContain("new GeminiGrader()");
    expect(read(factory)).toContain("env.aiMode");

    // Same rule for the speaking pipeline.
    const speakingFactory = path.join(SRC, "lib", "ai", "speaking", "index.ts");
    expect(read(speakingFactory)).toContain("new GeminiSpeakingGrader()");
    expect(read(speakingFactory)).toContain("new GeminiTranscriptionProvider()");
    expect(read(speakingFactory)).toContain("env.aiMode");
  });

  it("resolves the speaking providers inside the pipeline try block (misconfig must not crash a request)", () => {
    const service = read(path.join(SRC, "lib", "speaking", "service.ts"));
    const tryIndex = service.indexOf("try {");
    expect(tryIndex).toBeGreaterThan(-1);
    // Both factory calls must appear after the try starts.
    expect(service.indexOf("getTranscriptionProvider()")).toBeGreaterThan(tryIndex);
    expect(service.indexOf("getSpeakingGrader()")).toBeGreaterThan(tryIndex);
  });
});

describe("secrets", () => {
  it("has no hardcoded Google API key anywhere in src/", () => {
    const offenders = sourceFiles.filter((f) => /AIza[0-9A-Za-z_-]{10,}/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("never exposes a secret through NEXT_PUBLIC_*", () => {
    const offenders = sourceFiles.filter((f) =>
      /NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)/i.test(read(f))
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("exposes no NEXT_PUBLIC_* variable in src at all", () => {
    const usages = sourceFiles.filter((f) => read(f).includes("NEXT_PUBLIC_"));
    expect(usages.map(rel)).toEqual([]);
  });

  it("keeps .env out of git and .env.example keyless", () => {
    const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    expect(gitignore.split(/\r?\n/)).toContain(".env");

    const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    expect(example).toMatch(/^GEMINI_API_KEY=\s*$/m);
    expect(example).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
  });

  it("documents the required AI env vars in .env.example", () => {
    const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    for (const key of ["DATABASE_URL", "GEMINI_API_KEY", "GEMINI_MODEL", "AI_MODE"]) {
      expect(example).toContain(`${key}=`);
    }
  });

  it("does not log SMS verification codes or full phone numbers", () => {
    const sms = read(path.join(SRC, "lib", "auth", "sms.ts"));
    expect(sms).not.toMatch(/console\.(log|info|warn|error)/);
    expect(sms).not.toContain("message=\"");
    expect(sms).not.toContain("to=${phone}");
  });

  it("sets baseline browser security headers", () => {
    const config = fs.readFileSync(path.join(ROOT, "next.config.mjs"), "utf8");
    for (const header of [
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(config).toContain(header);
    }
  });
});

describe("data access", () => {
  it("uses no raw SQL (Prisma parameterizes all queries)", () => {
    const offenders = sourceFiles.filter((f) =>
      /\$(queryRawUnsafe|executeRawUnsafe|queryRaw|executeRaw)/.test(read(f))
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("scopes submission reads to the owning user inside the query", () => {
    const service = fs.readFileSync(path.join(SRC, "lib", "writing", "service.ts"), "utf8");
    expect(service).toMatch(/where:\s*\{\s*id:\s*submissionId,\s*userId/);
    expect(service).toMatch(/submission:\s*\{\s*userId\s*\}/);
  });
});
