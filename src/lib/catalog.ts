import type { Currency } from "../generated/prisma/client.ts";

/* Mirrors frontend/src/lib/types.ts and orders.ts. Keep the two in step. */

export const COLLECTIONS = ["Ìyàwó", "Olóri", "Heritage", "Everyday"] as const;

export const MATERIALS = [
  "Natural coral",
  "Baroque pearl",
  "Freshwater pearl",
  "18k gold-plated brass",
  "Crystal & rhinestone",
  "Brass & bead",
] as const;

export const BADGES = ["New", "Bestseller", "Limited", "Last one"] as const;

export type ShippingMethod = {
  id: string;
  name: string;
  detail: string;
  /** Major units. */
  price: { ngn: number; usd: number };
  regions: string[];
  /** Added to the longest made-to-order lead time for the ETA. */
  transitDays: number;
};

export const SHIPPING_METHODS: ShippingMethod[] = [
  { id: "lagos-sameday", name: "Lagos same-day courier", detail: "Ordered before 12pm, delivered today", price: { ngn: 5000, usd: 7 }, regions: ["Nigeria"], transitDays: 0 },
  { id: "nigeria-standard", name: "Nationwide (Nigeria)", detail: "2–4 working days, tracked", price: { ngn: 7500, usd: 10 }, regions: ["Nigeria"], transitDays: 4 },
  { id: "usps-ground", name: "USPS Ground", detail: "3–6 working days within the US", price: { ngn: 9000, usd: 12 }, regions: ["United States"], transitDays: 6 },
  { id: "dhl-express", name: "DHL Express", detail: "2–4 working days, worldwide, fully tracked", price: { ngn: 34000, usd: 45 }, regions: ["Nigeria", "United States"], transitDays: 4 },
  { id: "studio-pickup", name: "Studio pickup — Lekki", detail: "Collect from the studio, Tue–Sat", price: { ngn: 0, usd: 0 }, regions: ["Nigeria"], transitDays: 0 },
];

/** Orders at or over this subtotal ship free — except DHL Express, which is always charged. */
export const FREE_SHIPPING_OVER = { ngn: 250000, usd: 330 };
export const FREE_SHIPPING_EXCLUDES = ["dhl-express"];

/** Every order is paid online before it's made. (COD stays in the schema only for old orders.) */
export const PAYMENT_METHODS = [
  { id: "paystack", provider: "PAYSTACK", label: "Pay with Paystack", hint: "Card, bank transfer or USSD", currencies: ["NGN", "USD"] },
] as const satisfies readonly { id: string; provider: string; label: string; hint: string; currencies: readonly Currency[] }[];

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]["id"];

/** Order status as the frontend spells it. */
export const ORDER_STATUS_LABEL = {
  PENDING: "Pending",
  IN_STUDIO: "In the studio",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  REFUNDED: "Refunded",
  CANCELLED: "Cancelled",
} as const;

export const PAYMENT_STATUS_LABEL = {
  AWAITING: "Awaiting payment",
  PAID: "Paid",
  FAILED: "Payment failed",
  REFUNDED: "Refunded",
} as const;
