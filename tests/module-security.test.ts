/**
 * Security guards for the module platform (requirement: auth/ownership +
 * API security for Reading, Listening and Speaking).
 *
 * These are static + unit-level checks; the live HTTP behaviour (401 for
 * anonymous callers, 404 for another user's id, 409 for late writes) is
 * exercised by the end-to-end smoke script.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { responseMapSchema, objectiveModuleSchema, startAttemptSchema } from "@/lib/validations/testing";
import {
  createSpeakingSubmissionSchema,
  isAllowedAudioMimeType,
  baseMimeType,
  hasValidAudioSignature,
} from "@/lib/validations/speaking";
import { toPublicTest } from "@/lib/testing/types";
import type { TestDefinition } from "@/lib/testing/types";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("answer keys stay server-side", () => {
  const definition: TestDefinition = {
    id: "t1",
    module: "READING",
    title: "T",
    durationMinutes: 20,
    sections: [
      {
        id: "s1",
        order: 0,
        title: "S",
        passage: "passage",
        questions: [
          {
            id: "q1",
            number: 1,
            order: 0,
            type: "SHORT_ANSWER",
            prompt: "What is it?",
            options: null,
            answer: { answers: ["honey"], caseSensitive: false },
            explanation: "Because the text says so.",
            points: 1,
            groupId: null,
            meta: null,
          },
        ],
      },
    ],
  };

  it("strips answers and explanations from the client payload", () => {
    const json = JSON.stringify(toPublicTest(definition));
    expect(json).not.toContain("honey");
    expect(json).not.toContain("Because the text says so.");
    expect(json).toContain("What is it?");
  });

  it("ships the masked payload from the test route", () => {
    const route = read("src/app/api/tests/[module]/[testId]/route.ts");
    expect(route).toContain("getPublicTest");
    expect(route).not.toContain("loadTestDefinition");
  });
});

describe("ownership guards in the module APIs", () => {
  it("scopes attempt reads and writes to the session user", () => {
    for (const file of [
      "src/app/api/attempts/[id]/route.ts",
      "src/app/api/attempts/[id]/submit/route.ts",
      "src/app/api/attempts/[id]/result/route.ts",
    ]) {
      const source = read(file);
      expect(source).toContain("requireSession");
      expect(source).toContain("session.userId");
    }
  });

  it("checks audio ownership before streaming a recording", () => {
    const source = read("src/app/api/audio/[id]/route.ts");
    expect(source).toContain('asset.kind === "SPEAKING_RECORDING"');
    expect(source).toContain("asset.userId !== session.userId");
    expect(source).toContain('apiError(404, "audio_not_found")');
  });

  it("never returns storage keys or file paths from the speaking API", () => {
    const source = read("src/app/api/speaking/submissions/[id]/route.ts");
    expect(source).not.toContain("storageKey");
    expect(source).not.toContain("getPrivateStorage");
    // Only the ownership-checked URL is exposed.
    expect(source).toContain("/api/audio/");
  });

  it("keeps every module route server-only (no client component imports server services)", () => {
    const components = fs
      .readdirSync(path.join(SRC, "components", "speaking"))
      .map((name) => path.join(SRC, "components", "speaking", name));
    for (const file of components) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toMatch(/from\s+"@\/lib\/speaking\/service"/);
      expect(source).not.toMatch(/from\s+"@\/lib\/db"/);
      expect(source).not.toMatch(/from\s+"@\/lib\/ai/);
    }
  });
});

describe("input validation", () => {
  it("accepts only known modules", () => {
    expect(objectiveModuleSchema.safeParse("READING").success).toBe(true);
    expect(objectiveModuleSchema.safeParse("LISTENING").success).toBe(true);
    expect(objectiveModuleSchema.safeParse("SPEAKING").success).toBe(false);
    expect(objectiveModuleSchema.safeParse("DROP TABLE").success).toBe(false);
  });

  it("requires a plausible test id", () => {
    expect(startAttemptSchema.safeParse({ module: "READING", testId: "" }).success).toBe(false);
    expect(startAttemptSchema.safeParse({ module: "READING", testId: "abc" }).success).toBe(true);
    expect(
      startAttemptSchema.safeParse({ module: "READING", testId: "a".repeat(100) }).success
    ).toBe(false);
  });

  it("bounds the answer payload", () => {
    expect(responseMapSchema.safeParse({ q1: "answer" }).success).toBe(true);
    expect(responseMapSchema.safeParse({ q1: ["a", "b"] }).success).toBe(true);
    expect(responseMapSchema.safeParse({ q1: null }).success).toBe(true);
    // Oversized values and too many keys are rejected.
    expect(responseMapSchema.safeParse({ q1: "x".repeat(2001) }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`q${i}`, "x"]));
    expect(responseMapSchema.safeParse(many).success).toBe(false);
  });

  it("validates speaking submissions and audio types", () => {
    expect(createSpeakingSubmissionSchema.safeParse({ testId: "abc" }).success).toBe(true);
    expect(createSpeakingSubmissionSchema.safeParse({ testId: "" }).success).toBe(false);

    expect(isAllowedAudioMimeType("audio/webm;codecs=opus")).toBe(true);
    expect(isAllowedAudioMimeType("audio/wav")).toBe(true);
    expect(isAllowedAudioMimeType("application/pdf")).toBe(false);
    expect(isAllowedAudioMimeType("text/html")).toBe(false);
    expect(baseMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("rejects renamed non-audio files using container signatures", () => {
    const wav = Buffer.alloc(12);
    wav.write("RIFF", 0);
    wav.write("WAVE", 8);
    expect(hasValidAudioSignature(wav, "audio/wav")).toBe(true);
    expect(hasValidAudioSignature(Buffer.from("<script>alert(1)</script>"), "audio/wav")).toBe(false);
    expect(hasValidAudioSignature(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), "audio/webm")).toBe(true);
    expect(hasValidAudioSignature(Buffer.from("not webm"), "audio/webm")).toBe(false);
  });
});

describe("no secrets in the new modules", () => {
  it("never mentions the API key outside lib/env.ts", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    walk(SRC);

    const offenders = files
      .filter((file) => !file.endsWith(path.join("lib", "env.ts")))
      .filter((file) => /process\.env\.GEMINI_API_KEY/.test(fs.readFileSync(file, "utf8")))
      // The speaking factory only checks whether a key exists (never reads its value).
      .filter((file) => !file.endsWith(path.join("lib", "ai", "speaking", "index.ts")))
      .map((file) => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });

  it("keeps raw provider responses out of API responses", () => {
    const evaluateRoute = read("src/app/api/speaking/submissions/[id]/evaluate/route.ts");
    expect(evaluateRoute).not.toContain("rawResponse");
    expect(evaluateRoute).toContain("502");
    expect(evaluateRoute).toContain("evaluation_failed");

    const submissionRoute = read("src/app/api/speaking/submissions/[id]/route.ts");
    expect(submissionRoute).not.toContain("rawResponse");
  });
});
