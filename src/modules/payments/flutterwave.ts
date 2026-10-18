import { env } from "../../config/env.ts";
import type { Order } from "../../generated/prisma/client.ts";
import { HttpError } from "../../lib/http-error.ts";
import { randomToken } from "../../lib/tokens.ts";

/* ------------------------------------------------------------------ *
 * Flutterwave (Standard, v3) — one integration for both currencies.
 * The customer pays on Flutterwave's hosted page: card, bank transfer,
 * USSD and whatever else is switched on for the business. Amounts go to
 * Flutterwave in major units (685000 / 900.50), not kobo or cents.
 *   USD needs enabling on the Flutterwave account before it can be charged.
 * ------------------------------------------------------------------ */

export type Verification = {
  paid: boolean;
  /** In minor units of `currency`, to compare with what the order expects. */
  amountMinor: number;
  currency: string;
  /** Our order reference, echoed back from the meta we sent. */
  orderReference?: string;
};

export const paymentCurrencies = () =>
  env.FLW_SECRET_KEY ? env.FLW_CURRENCIES.split(",").map((c) => c.trim().toUpperCase()) : [];

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!env.FLW_SECRET_KEY) throw new HttpError(503, "Online payments aren't configured yet.", "PAYMENT_DISABLED");
  const res = await fetch(`https://api.flutterwave.com/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.FLW_SECRET_KEY}`, "Content-Type": "application/json" },
  });
  const json = (await res.json().catch(() => ({ status: "error", message: res.statusText }))) as {
    status: string;
    message: string;
    data: T;
  };
  if (!res.ok || json.status !== "success") throw new HttpError(502, `Flutterwave: ${json.message}`, "PAYMENT_PROVIDER");
  return json.data;
}

/**
 * Starts a Flutterwave checkout and returns the hosted payment page URL.
 * Each attempt gets a fresh tx_ref — a reference can't be reused after an
 * abandoned try — with our order reference carried in the meta. Flutterwave
 * sends the customer back to `returnUrl` with ?status&tx_ref&transaction_id
 * added, whether they paid, failed or cancelled.
 */
export async function initializePayment(order: Order, returnUrl: string) {
  const reference = `${order.reference}-${randomToken(4)}`;
  const data = await call<{ link: string }>("/payments", {
    method: "POST",
    body: JSON.stringify({
      tx_ref: reference,
      amount: (order.currency === "NGN" ? order.totalKobo : order.totalCents) / 100,
      currency: order.currency,
      redirect_url: returnUrl,
      customer: { email: order.email, name: order.name, phonenumber: order.phone },
      customizations: { title: "Lui'Deo Jewelry", description: `Order ${order.reference}` },
      meta: { order_reference: order.reference },
    }),
  });
  return { redirectUrl: data.link, providerRef: reference };
}

type Transaction = { status: string; amount: number; currency: string; tx_ref: string; meta?: { order_reference?: string } | null };

const toVerification = (t: Transaction): Verification => ({
  paid: t.status === "successful",
  amountMinor: Math.round(t.amount * 100),
  currency: t.currency,
  // Attempt references look like LD-7K3M9Q-abc123; the order reference is the meta, or the prefix.
  orderReference: t.meta?.order_reference ?? t.tx_ref.replace(/-[A-Za-z0-9_-]{6}$/, ""),
});

/** By our own reference — used when the customer lands back before the webhook. */
export async function verifyByReference(providerRef: string): Promise<Verification> {
  return toVerification(await call<Transaction>(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(providerRef)}`));
}

/** By Flutterwave's transaction id — what the webhook carries. */
export async function verifyById(transactionId: string | number): Promise<Verification> {
  return toVerification(await call<Transaction>(`/transactions/${encodeURIComponent(String(transactionId))}/verify`));
}
