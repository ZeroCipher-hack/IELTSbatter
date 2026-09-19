/**
 * SMS provider abstraction.
 *
 * SMS_MODE=mock  — logs the code to the server console (development).
 * SMS_MODE=live  — wire a real provider (Eskiz, Playmobile, etc.) here.
 *
 * Verification codes are stored in the SmsCode table; the architecture is
 * ready for real phone verification without touching the rest of the app.
 */
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

const CODE_TTL_MINUTES = 5;

export interface SmsSender {
  send(phone: string, message: string): Promise<void>;
}

class MockSmsSender implements SmsSender {
  async send(phone: string, message: string): Promise<void> {
    // Development only — never log codes in production.
    console.log(`[sms:mock] to=${phone} message="${message}"`);
  }
}

class LiveSmsSender implements SmsSender {
  async send(phone: string): Promise<void> {
    throw new Error(
      `SMS_MODE=live is not configured (tried to send to ${phone.slice(0, 4)}…). ` +
        "Implement LiveSmsSender with your SMS provider."
    );
  }
}

export function getSmsSender(): SmsSender {
  return env.smsMode === "live" ? new LiveSmsSender() : new MockSmsSender();
}

export async function issueVerificationCode(phone: string): Promise<void> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await prisma.smsCode.create({
    data: {
      phone,
      code,
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    },
  });
  await getSmsSender().send(phone, `AXI tasdiqlash kodi: ${code}`);
}

export async function verifyCode(phone: string, code: string): Promise<boolean> {
  const record = await prisma.smsCode.findFirst({
    where: { phone, code, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return false;
  await prisma.smsCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return true;
}
