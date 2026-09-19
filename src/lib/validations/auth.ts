import { z } from "zod";

/** Uzbekistan phone format: +998 XX XXX XX XX (digits only after +998). */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-()]/g, ""))
  .pipe(z.string().regex(/^\+?998\d{9}$/, "invalid_phone"))
  .transform((v) => (v.startsWith("+") ? v : `+${v}`));

export const registerSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().min(2, "name_too_short").max(100),
  password: z.string().min(6, "password_too_short").max(128),
});

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, "password_required").max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
