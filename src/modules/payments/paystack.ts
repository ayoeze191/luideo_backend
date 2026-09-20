import { env } from "../../config/env.ts";
import type { Order } from "../../generated/prisma/client.ts";
import { HttpError } from "../../lib/http-error.ts";
import { randomToken } from "../../lib/tokens.ts";

/* ------------------------------------------------------------------ *
 * Paystack — one integration for both currencies.
 *   NGN: charged in kobo. Card, bank transfer, USSD, all on Paystack's page.
 *   USD: charged in cents. Must be switched on for the business in the
 *        Paystack dashboard first (Settings → Preferences → Currencies).
 * ------------------------------------------------------------------ */

export type Verification = {
  paid: boolean;
  /** In minor units of `currency`. */
  amountMinor: number;
  currency: string;
  /** Our order reference, echoed back from the metadata we sent. */
  orderReference?: string;
};

export const paystackCurrencies = () =>
  env.PAYSTACK_SECRET_KEY ? env.PAYSTACK_CURRENCIES.split(",").map((c) => c.trim().toUpperCase()) : [];

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!env.PAYSTACK_SECRET_KEY) throw new HttpError(503, "Card payments aren't configured yet.", "PAYMENT_DISABLED");
  const res = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
  });
  const json = (await res.json().catch(() => ({ status: false, message: res.statusText }))) as {
    status: boolean;
    message: string;
    data: T;
  };
  if (!res.ok || !json.status) throw new HttpError(502, `Paystack: ${json.message}`, "PAYMENT_PROVIDER");
  return json.data;
}

/**
 * Starts a Paystack checkout and returns the hosted payment page URL.
 * Each attempt gets a fresh reference — Paystack rejects a reused one after
 * an abandoned try — with our order reference carried in the metadata.
 */
export async function initializePayment(order: Order, urls: { success: string; cancel: string }) {
  const reference = `${order.reference}-${randomToken(4)}`;
  const data = await call<{ authorization_url: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: order.email,
      amount: order.currency === "NGN" ? order.totalKobo : order.totalCents,
      currency: order.currency,
      reference,
      callback_url: urls.success,
      metadata: {
        order_reference: order.reference,
        cancel_action: urls.cancel,
        custom_fields: [{ display_name: "Order", variable_name: "order", value: order.reference }],
      },
    }),
  });
  return { redirectUrl: data.authorization_url, providerRef: reference };
}

export async function verifyPayment(providerRef: string): Promise<Verification> {
  const data = await call<{ status: string; amount: number; currency: string; metadata?: { order_reference?: string } }>(
    `/transaction/verify/${encodeURIComponent(providerRef)}`,
  );
  return {
    paid: data.status === "success",
    amountMinor: data.amount,
    currency: data.currency,
    orderReference: data.metadata?.order_reference,
  };
}
