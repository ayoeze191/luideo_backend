import type { Currency } from "../generated/prisma/client.ts";

/* Mirrors frontend/src/lib/types.ts and orders.ts. Keep the two in step. */

/* Collections and materials are in the database now: see lib/catalog-options.ts. */

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
  /**
   * "lagos": only for a Lagos address, and the customer picks their area from
   * `areas`. "outside-lagos": only for an address in another state.
   */
  zone?: "lagos" | "outside-lagos";
  areas?: string[];
};

/* ------------------------------------------------------------------ *
 * Delivery prices, from the studio's own rate card. Within Lagos the
 * price depends on the area; the rest of Nigeria is one price; pickup is
 * free. There's no free delivery, whatever the order size. U.S. delivery is
 * a flat $40; the listed European and African countries are a flat $80.
 *
 * To change a price, change `ngn` here; `usd` follows from it (for
 * customers paying in dollars for a Nigerian address).
 * ------------------------------------------------------------------ */

const USD_RATE = 1500;
const ngn = (n: number) => ({ ngn: n, usd: Math.ceil(n / USD_RATE) });

const AFRICAN_COUNTRIES = [
  "Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi", "Cabo Verde", "Cameroon", "Central African Republic", "Chad", "Comoros", "Congo", "Democratic Republic of the Congo", "Djibouti", "Egypt", "Equatorial Guinea", "Eritrea", "Eswatini", "Ethiopia", "Gabon", "Gambia", "Ghana", "Guinea", "Guinea-Bissau", "Ivory Coast", "Kenya", "Lesotho", "Liberia", "Libya", "Madagascar", "Malawi", "Mali", "Mauritania", "Mauritius", "Morocco", "Mozambique", "Namibia", "Niger", "Rwanda", "São Tomé and Príncipe", "Senegal", "Seychelles", "Sierra Leone", "Somalia", "South Africa", "South Sudan", "Sudan", "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia", "Zimbabwe",
];

const EUROPEAN_COUNTRIES = [
  "Albania", "Andorra", "Armenia", "Austria", "Azerbaijan", "Belarus", "Belgium", "Bosnia and Herzegovina", "Bulgaria", "Croatia", "Cyprus", "Czechia", "Denmark", "Estonia", "Finland", "France", "Georgia", "Germany", "Greece", "Hungary", "Iceland", "Ireland", "Italy", "Kosovo", "Latvia", "Liechtenstein", "Lithuania", "Luxembourg", "Malta", "Moldova", "Monaco", "Montenegro", "Netherlands", "North Macedonia", "Norway", "Poland", "Portugal", "Romania", "Russia", "San Marino", "Serbia", "Slovakia", "Slovenia", "Spain", "Sweden", "Switzerland", "Turkey", "Ukraine", "United Kingdom", "Vatican City",
];

const lagos = (id: string, name: string, price: number, areas: string[]): ShippingMethod => ({
  id: `lagos-${id}`,
  name: `Lagos — ${name}`,
  detail: "Delivered by courier once your piece is ready",
  price: ngn(price),
  regions: ["Nigeria"],
  transitDays: 2,
  zone: "lagos",
  areas,
});

export const SHIPPING_METHODS: ShippingMethod[] = [
  lagos("ikeja", "Ikeja & around", 5000, [
    "Ikeja", "Abule Egba", "Iju Ishaga", "Obawole", "Ogba", "Meiran", "Agege", "Allen Avenue",
    "Airport Road", "Magodo Phase 1", "Ojodu Berger", "Berger",
  ]),
  lagos("maryland", "Maryland & around", 6000, [
    "Maryland", "Palmgrove", "Jibowu", "Fadeyi", "Obanikoro", "Mende", "Anthony", "Mushin",
  ]),
  lagos("island", "Victoria Island, Ikoyi & Lekki Phase 1", 7000, [
    "Victoria Island", "Ikoyi", "Lekki Phase 1", "Jakande", "Ikate",
  ]),
  lagos("alimosho", "Alimosho & around", 8000, [
    "OPIC", "Ayobo", "Ipaja", "Iyana Ipaja", "Egbeda", "Ikotun", "Ikotun Egbe", "Abaranje", "Kola",
    "Agbado", "Alagbado", "Iyana Oba", "Igbo Elerin",
  ]),
  lagos("surulere", "Surulere, Yaba & around", 8000, [
    "Surulere", "Yaba", "Cele", "Ijesha", "Mile 2", "Orile Iganmu", "Orile", "Alaba", "Suru Alaba",
    "Ijora", "Ijora 7Up",
  ]),
  lagos("festac", "Festac, Trade Fair & around", 8000, [
    "Trade Fair", "Ojo Alaba", "Okoko", "Isolo", "Festac", "Satellite Town",
  ]),
  lagos("vgc", "Orchid, VGC & Ikota", 8000, ["Orchid", "VGC", "Ikota"]),
  lagos("ajah", "Ajah & around", 9000, [
    "Ajah", "Addo Road", "Lagos Business School", "Badore", "Shoprite Sangotedo Road",
  ]),
  lagos("sangotedo", "Sangotedo, Abijo & beyond", 12000, ["Sangotedo", "Abijo"]),
  {
    id: "outside-lagos",
    name: "Delivery outside Lagos",
    detail: "Anywhere else in Nigeria, by courier",
    price: ngn(15000),
    regions: ["Nigeria"],
    transitDays: 5,
    zone: "outside-lagos",
  },
  {
    id: "pickup",
    name: "Pickup",
    detail: "Collect it yourself — we'll message you the address and time when it's ready",
    price: ngn(0),
    regions: ["Nigeria"],
    transitDays: 0,
  },
  {
    id: "us-delivery",
    name: "United States delivery",
    detail: "Flat-rate delivery to the United States",
    price: { ngn: 40 * USD_RATE, usd: 40 },
    regions: ["United States"],
    transitDays: 10,
  },
  {
    id: "international-delivery",
    name: "International delivery",
    detail: "Flat-rate delivery to listed European and African countries",
    price: { ngn: 80 * USD_RATE, usd: 80 },
    regions: [...AFRICAN_COUNTRIES, ...EUROPEAN_COUNTRIES],
    transitDays: 14,
  },
];


/** Every order is paid online before it's made. (COD stays in the schema only for old orders.) */
export const PAYMENT_METHODS = [
  { id: "flutterwave", provider: "FLUTTERWAVE", label: "Pay with Flutterwave", hint: "Card, bank transfer or USSD", currencies: ["NGN", "USD"] },
  { id: "manual-us", provider: "MANUAL_US", label: "Pay by Zelle, Apple Cash or wire", hint: "USD only — send payment, then upload your receipt for review", currencies: ["USD"] },
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
