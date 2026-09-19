/**
 * Payment provider abstraction for Click / Payme.
 *
 * PAYMENT_MODE=mock  — instant fake success (development/testing).
 * PAYMENT_MODE=click — implement ClickProvider with real credentials.
 * PAYMENT_MODE=payme — implement PaymeProvider with real credentials.
 *
 * The rest of the app talks only to `getPaymentProvider()`, so wiring real
 * providers later requires no changes outside this directory.
 */
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

export interface CreatePaymentInput {
  userId: string;
  amount: number; // in UZS (tiyin-free integer)
  description?: string;
}

export interface PaymentResult {
  paymentId: string;
  /** URL the user should be redirected to (real providers) or null for mock. */
  redirectUrl: string | null;
  status: "CREATED" | "PAID";
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<PaymentResult>;
}

class MockPaymentProvider implements PaymentProvider {
  readonly name = "MOCK";

  async createPayment(input: CreatePaymentInput): Promise<PaymentResult> {
    const payment = await prisma.payment.create({
      data: {
        userId: input.userId,
        provider: "MOCK",
        amount: input.amount,
        status: "PAID", // mock pays instantly
      },
    });
    return { paymentId: payment.id, redirectUrl: null, status: "PAID" };
  }
}

class ClickPaymentProvider implements PaymentProvider {
  readonly name = "CLICK";
  async createPayment(input: CreatePaymentInput): Promise<PaymentResult> {
    throw new Error(
      `Click integration is not configured (payment of ${input.amount} UZS rejected). ` +
        "Set credentials and implement ClickPaymentProvider."
    );
  }
}

class PaymePaymentProvider implements PaymentProvider {
  readonly name = "PAYME";
  async createPayment(input: CreatePaymentInput): Promise<PaymentResult> {
    throw new Error(
      `Payme integration is not configured (payment of ${input.amount} UZS rejected). ` +
        "Set credentials and implement PaymePaymentProvider."
    );
  }
}

export function getPaymentProvider(): PaymentProvider {
  switch (env.paymentMode) {
    case "click":
      return new ClickPaymentProvider();
    case "payme":
      return new PaymePaymentProvider();
    default:
      return new MockPaymentProvider();
  }
}
