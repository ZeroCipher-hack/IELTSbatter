import { describe, it, expect } from "vitest";
import { registerSchema, loginSchema, phoneSchema } from "@/lib/validations/auth";
import { writingSubmissionSchema } from "@/lib/validations/writing";

describe("phoneSchema", () => {
  it("accepts Uzbekistan numbers with/without + and spaces", () => {
    expect(phoneSchema.parse("+998901234567")).toBe("+998901234567");
    expect(phoneSchema.parse("998901234567")).toBe("+998901234567");
    expect(phoneSchema.parse("+998 90 123 45 67")).toBe("+998901234567");
  });

  it("rejects non-UZ or malformed numbers", () => {
    expect(phoneSchema.safeParse("+7901234567").success).toBe(false);
    expect(phoneSchema.safeParse("+99890123456").success).toBe(false); // 8 digits
    expect(phoneSchema.safeParse("hello").success).toBe(false);
  });
});

describe("registerSchema", () => {
  it("accepts valid input", () => {
    const r = registerSchema.safeParse({
      phone: "+998901234567",
      name: "Aziz",
      password: "secret1",
    });
    expect(r.success).toBe(true);
  });

  it("rejects short password and short name", () => {
    expect(
      registerSchema.safeParse({ phone: "+998901234567", name: "A", password: "secret1" }).success
    ).toBe(false);
    expect(
      registerSchema.safeParse({ phone: "+998901234567", name: "Aziz", password: "123" }).success
    ).toBe(false);
  });
});

describe("loginSchema", () => {
  it("requires password", () => {
    expect(loginSchema.safeParse({ phone: "+998901234567", password: "" }).success).toBe(false);
  });
});

describe("writingSubmissionSchema", () => {
  it("accepts a valid submission and defaults testType", () => {
    const r = writingSubmissionSchema.parse({
      question: "Some people believe X. Discuss both views.",
      essay: "This is a sufficiently long essay body for validation purposes, repeated words words words.",
    });
    expect(r.testType).toBe("TASK_2");
  });

  it("rejects a too-short essay", () => {
    expect(
      writingSubmissionSchema.safeParse({ question: "Valid question here?", essay: "too short" })
        .success
    ).toBe(false);
  });
});
