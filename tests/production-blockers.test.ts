import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "@/lib/storage";
import { buildContentSecurityPolicy, generateCspNonce, isValidCspNonce } from "@/lib/security/csp";
import { decideBeginPart, timerRemaining } from "@/lib/speaking/state-machine";
import { parseIdempotencyKey, writingRequestFingerprint } from "@/lib/writing/idempotency";
import { MemoryRateLimitStore, rateLimit, resetRateLimitsForTesting } from "@/lib/utils/rate-limit";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

describe("speaking state machine", () => {
  it("recovers timers from persisted server timestamps", () => {
    expect(timerRemaining(new Date("2026-01-01T00:00:00Z"), 60, new Date("2026-01-01T00:00:17Z"))).toBe(43);
    expect(timerRemaining(new Date("2026-01-01T00:00:00Z"), 60, new Date("2026-01-01T00:02:00Z"))).toBe(0);
  });
  it("rejects early and invalid transitions", () => {
    expect(decideBeginPart("PREPARING", 1, 2)).toEqual({ kind: "REJECT", code: "timer_not_elapsed" });
    expect(decideBeginPart("UPLOADING", 1, 0)).toEqual({ kind: "REJECT", code: "invalid_transition" });
    expect(decideBeginPart("FAILED", 1, 0)).toEqual({ kind: "REJECT", code: "interview_expired" });
  });
  it("makes a duplicate transition idempotent", () => {
    expect(decideBeginPart("PART_2", 2, 0)).toEqual({ kind: "IDEMPOTENT" });
    expect(decideBeginPart("PREPARING", 3, 0)).toEqual({ kind: "APPLY", next: "PART_3" });
  });
});

describe("writing idempotency", () => {
  it("validates keys and fingerprints the complete request", () => {
    expect(parseIdempotencyKey("retry-key-000001")).toBe("retry-key-000001");
    expect(() => parseIdempotencyKey("short")).toThrow("invalid_idempotency_key");
    const base = { question: "A valid question that is long enough", essay: "A valid essay body that is long enough to submit.", testType: "TASK_2" as const };
    expect(writingRequestFingerprint(base, "uz")).toBe(writingRequestFingerprint(base, "uz"));
    expect(writingRequestFingerprint(base, "uz")).not.toBe(writingRequestFingerprint(base, "ru"));
  });
});

describe("storage provider", () => {
  it("uploads, retrieves, checks, deletes and handles missing objects", async () => {
    const storage = new MemoryStorage();
    await storage.put({ key: "speaking/user/file.webm", data: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" });
    expect(await storage.exists("speaking/user/file.webm")).toBe(true);
    expect((await storage.get("speaking/user/file.webm"))?.data).toEqual(Buffer.from([1, 2, 3]));
    await storage.delete("speaking/user/file.webm");
    expect(await storage.exists("speaking/user/file.webm")).toBe(false);
    expect(await storage.get("missing.webm")).toBeNull();
  });
});

describe("distributed rate-limit contract", () => {
  it("increments atomically under concurrent calls and expires", async () => {
    const store = new MemoryRateLimitStore();
    const counts = await Promise.all(Array.from({ length: 20 }, () => store.increment("bucket", 1000)));
    expect(new Set(counts).size).toBe(20);
    expect(await store.get("bucket")).toBe(20);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1001);
    expect(await store.get("bucket")).toBe(0);
    vi.useRealTimers();
  });
  it("enforces a bucket cap", async () => {
    await resetRateLimitsForTesting();
    const allowed = await Promise.all(Array.from({ length: 5 }, () => rateLimit("same", { limit: 3, windowMs: 1000 })));
    expect(allowed.filter(Boolean)).toHaveLength(3);
  });
});

describe("CSP preparation", () => {
  it("builds a unique valid nonce and report-only-ready policy", () => {
    const first = generateCspNonce();
    const second = generateCspNonce();
    expect(first).not.toBe(second);
    expect(isValidCspNonce(first)).toBe(true);
    const policy = buildContentSecurityPolicy(first, false);
    expect(policy).toContain(`script-src 'nonce-${first}' 'strict-dynamic'`);
    expect(policy).toContain("report-uri /api/security/csp-report");
    expect(policy).not.toContain("'unsafe-eval'");
  });
  it("emits report-only instead of enforcing the policy", async () => {
    const response = await proxy(new NextRequest("http://localhost/"));
    const header = response.headers.get("content-security-policy-report-only");
    expect(header).toContain("script-src 'nonce-");
    expect(response.headers.get("content-security-policy")).toBeNull();
  });
});
