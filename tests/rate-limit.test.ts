import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit, resetRateLimitsForTesting } from "@/lib/utils/rate-limit";

afterEach(async () => {
  await resetRateLimitsForTesting();
  vi.useRealTimers();
});

describe("rate limiter", () => {
  it("enforces the window and recovers after expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(await rateLimit("login:one", { limit: 1, windowMs: 1_000 })).toBe(true);
    expect(await rateLimit("login:one", { limit: 1, windowMs: 1_000 })).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(await rateLimit("login:one", { limit: 1, windowMs: 1_000 })).toBe(true);
  });

  it("bounds attacker-controlled bucket cardinality", async () => {
    for (let index = 0; index < 10_000; index += 1) {
      expect(await rateLimit(`ip:${index}`, { limit: 1, windowMs: 60_000 })).toBe(true);
    }
    expect(await rateLimit("ip:overflow", { limit: 1, windowMs: 60_000 })).toBe(false);
  });
});
