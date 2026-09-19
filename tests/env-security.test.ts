import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";

const originalSessionSecret = process.env.SESSION_SECRET;

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
});

describe("session secret validation", () => {
  it("rejects missing and short signing secrets", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => env.sessionSecret).toThrow("Missing required environment variable");

    vi.stubEnv("SESSION_SECRET", "too-short");
    expect(() => env.sessionSecret).toThrow("at least 32 characters");
  });

  it("accepts a sufficiently long signing secret", () => {
    vi.stubEnv("SESSION_SECRET", "test-only-session-secret-32-characters");
    expect(env.sessionSecret).toHaveLength(38);
  });
});
