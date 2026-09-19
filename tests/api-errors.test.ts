/**
 * API error responses must be uniform, translatable (code doubles as an i18n
 * key) and must never expose stack traces, provider messages or secrets.
 */
import { describe, it, expect, vi } from "vitest";
import { ZodError } from "zod";
import { apiError, handleApiError, clientIp } from "@/lib/utils/api";
import { UnauthorizedError } from "@/lib/auth/session";
import { writingSubmissionSchema } from "@/lib/validations/writing";

async function body(response: Response) {
  return (await response.json()) as { error: { code: string; message: string } };
}

describe("apiError", () => {
  it("returns a uniform { error: { code, message } } shape", async () => {
    const response = apiError(429, "rate_limited");
    expect(response.status).toBe(429);
    expect(await body(response)).toEqual({ error: { code: "rate_limited", message: "rate_limited" } });
  });
});

describe("handleApiError", () => {
  it("maps UnauthorizedError to 401", async () => {
    const response = handleApiError(new UnauthorizedError());
    expect(response.status).toBe(401);
    expect((await body(response)).error.code).toBe("unauthorized");
  });

  it("maps ZodError to a 400 with the failing path", async () => {
    const parsed = writingSubmissionSchema.safeParse({ question: "short", essay: "x".repeat(60) });
    const response = handleApiError(parsed.error as ZodError);
    expect(response.status).toBe(400);
    expect((await body(response)).error.code).toBe("validation_error");
  });

  it("maps malformed JSON syntax to a safe 400", async () => {
    const response = handleApiError(new SyntaxError("Unexpected token at position 3"));
    expect(response.status).toBe(400);
    expect((await body(response)).error.code).toBe("invalid_json");
  });

  it("returns a generic 500 without leaking internals", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "AIzaSyD-EXAMPLE-KEY-1234567890";

    const response = handleApiError(new Error(`boom with key ${secret} at /var/app/secret.ts:42`));
    const payload = await body(response);

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("internal_error");
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(JSON.stringify(payload)).not.toContain("secret.ts");
    expect(JSON.stringify(payload)).not.toContain("stack");
    expect(spy).toHaveBeenCalledOnce();
    expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    spy.mockRestore();
  });
});

describe("clientIp", () => {
  it("only trusts a validated forwarded address behind a configured proxy", () => {
    process.env.TRUST_PROXY = "true";
    expect(
      clientIp(new Request("http://localhost", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } }))
    ).toBe("1.2.3.4");
    expect(clientIp(new Request("http://localhost", { headers: { "x-forwarded-for": "spoof" } }))).toBe("unknown");
    delete process.env.TRUST_PROXY;
    expect(clientIp(new Request("http://localhost", { headers: { "x-forwarded-for": "1.2.3.4" } }))).toBe("direct");
  });
});
