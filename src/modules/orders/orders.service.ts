import { env } from "../../config/env.ts";
import * as emails from "../../emails/templates.ts";
import type { Currency, Order, OrderItem, User } from "../../generated/prisma/client.ts";
import {
  FREE_SHIPPING_EXCLUDES,
  FREE_SHIPPING_OVER,
  PAYMENT_METHODS,
  SHIPPING_METHODS,
  type PaymentMethodId,
} from "../../lib/catalog.ts";
import { HttpError, badRequest } from "../../lib/http-error.ts";
import { sendMailInBackground } from "../../lib/mailer.ts";
import { toMinor } from "../../lib/money.ts";
import { prisma } from "../../lib/prisma.ts";
import { syncSalesInBackground } from "../../lib/sales.ts";
import { formatPrice, type Variant } from "../../lib/serialize.ts";
import { hashToken, orderReference, randomToken, safeEqual } from "../../lib/tokens.ts";
import { subscribeGuest, setPreferences } from "../alerts/alerts.service.ts";
import { initializePayment, paystackCurrencies, verifyPayment } from "../payments/paystack.ts";

export type CheckoutInput = {
  email: string;
  name: string;
  phone: string;
  address: { line1: string; city: string; state: string; country: string; postcode?: string };
  shippingMethodId: string;
  paymentMethod: PaymentMethodId;
  currency: Currency;
  items: { productId: string; finishId: string; sizeId?: string; quantity: number }[];
  notifySimilar: boolean;
  note?: string;
  giftMessage?: string;
};

export const orderInclude = { items: true, events: true } as const;

/**
 * Prices, stock, shipping and ETA are all recomputed here from the database.
 * Nothing money-related is taken from the client.
 */
export async function createOrder(input: CheckoutInput, user?: User) {
  const method = PAYMENT_METHODS.find((m) => m.id === input.paymentMethod)!;
  if (!(method.currencies as readonly string[]).includes(input.currency)) {
    throw badRequest(`${method.label} isn't available for ${input.currency} orders.`, "PAYMENT_CURRENCY");
  }
  if (method.provider === "PAYSTACK" && !paystackCurrencies().includes(input.currency)) {
    throw new HttpError(503, `Online payment in ${input.currency} isn't available right now.`, "PAYMENT_DISABLED");
  }

  const shipping = SHIPPING_METHODS.find((s) => s.id === input.shippingMethodId);
  if (!shipping) throw badRequest("Please choose a shipping method.", "SHIPPING");
  if (!shipping.regions.includes(input.address.country)) {
    throw badRequest(`${shipping.name} doesn't deliver to ${input.address.country}.`, "SHIPPING_REGION");
  }

  const products = await prisma.product.findMany({
    where: { id: { in: input.items.map((i) => i.productId) }, published: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const wanted = new Map<string, number>();
  const lines = input.items.map((item) => {
    const product = byId.get(item.productId);
    if (!product) throw badRequest("One of the pieces in your bag is no longer available.", "PRODUCT_UNAVAILABLE");

    const finish = (product.finishes as Variant[]).find((f) => f.id === item.finishId);
    if (!finish?.inStock) throw badRequest(`That finish of ${product.name} isn't available.`, "VARIANT_UNAVAILABLE");

    const sizes = product.sizes as Variant[] | null;
    const size = sizes?.find((s) => s.id === item.sizeId);
    if (sizes?.length && !size?.inStock) throw badRequest(`Please choose an available option for ${product.name}.`, "VARIANT_UNAVAILABLE");

    wanted.set(product.id, (wanted.get(product.id) ?? 0) + item.quantity);
    if (wanted.get(product.id)! > product.stock) {
      throw badRequest(
        product.stock === 0 ? `${product.name} is sold out.` : `Only ${product.stock} of ${product.name} left.`,
        "OUT_OF_STOCK",
      );
    }

    return {
      productId: product.id,
      name: product.name,
      slug: product.slug,
      photo: product.photo,
      category: product.categorySlug,
      collection: product.collection,
      material: product.material,
      finishId: finish.id,
      finishLabel: finish.label,
      sizeId: size?.id,
      sizeLabel: size?.label,
      quantity: item.quantity,
      unitKobo: product.priceKobo,
      unitCents: product.priceCents,
      leadDays: product.madeToOrderDays,
    };
  });

  const subtotalKobo = lines.reduce((n, l) => n + l.unitKobo * l.quantity, 0);
  const subtotalCents = lines.reduce((n, l) => n + l.unitCents * l.quantity, 0);

  // The threshold is judged in the currency the customer is paying in.
  const freeShipping =
    !FREE_SHIPPING_EXCLUDES.includes(shipping.id) &&
    (input.currency === "NGN"
      ? subtotalKobo >= toMinor(FREE_SHIPPING_OVER.ngn)
      : subtotalCents >= toMinor(FREE_SHIPPING_OVER.usd));
  const shippingKobo = freeShipping ? 0 : toMinor(shipping.price.ngn);
  const shippingCents = freeShipping ? 0 : toMinor(shipping.price.usd);
  const etaDays = Math.max(...lines.map((l) => l.leadDays)) + shipping.transitDays;

  const guestToken = randomToken();
  const email = input.email.trim().toLowerCase();

  const order = await prisma.order.create({
    data: {
      reference: orderReference(),
      guestTokenHash: hashToken(guestToken),
      userId: user?.id,
      email,
      name: input.name,
      phone: input.phone,
      currency: input.currency,
      paymentProvider: method.provider,
      subtotalKobo,
      subtotalCents,
      shippingKobo,
      shippingCents,
      totalKobo: subtotalKobo + shippingKobo,
      totalCents: subtotalCents + shippingCents,
      shippingMethod: shipping.name,
      address: input.address,
      note: [input.giftMessage && `Gift message: “${input.giftMessage}”`, input.note]
        .filter(Boolean)
        .join("\n") || undefined,
      etaDays,
      items: { create: lines.map(({ leadDays: _, ...l }) => l) },
      events: { create: [{ label: "Order placed" }] },
    },
    include: orderInclude,
  });

  if (input.notifySimilar) {
    // Signed-in and verified: it lives on their account. Otherwise it's keyed by
    // email and gets attached to an account once that email is verified.
    if (user?.emailVerifiedAt && user.email === email) await setPreferences(user, { enabled: true, similarToPurchases: true });
    else await subscribeGuest(email);
  }

  return { order, guestToken };
}

export function paymentUrls(order: Order, guestToken: string) {
  const q = `ref=${encodeURIComponent(order.reference)}&token=${encodeURIComponent(guestToken)}`;
  return {
    success: `${env.FRONTEND_URL}/checkout/success?${q}`,
    cancel: `${env.FRONTEND_URL}/checkout?cancelled=1&${q}`,
  };
}

/** Starts (or restarts) the Paystack checkout and returns its URL. */
export async function startPayment(order: Order, guestToken: string) {
  if (order.paymentStatus === "PAID") throw badRequest("This order is already paid.", "ALREADY_PAID");
  if (order.status === "CANCELLED") throw badRequest("This order was cancelled.", "CANCELLED");
  if (order.paymentProvider !== "PAYSTACK") throw badRequest("This order is paid on delivery.", "NOT_ONLINE");
  const { redirectUrl, providerRef } = await initializePayment(order, paymentUrls(order, guestToken));
  await prisma.order.update({ where: { id: order.id }, data: { providerRef } });
  return redirectUrl;
}

/** Ask Paystack directly — used when the customer lands back before the webhook. */
export async function reconcilePayment(order: Order) {
  if (order.paymentStatus !== "AWAITING" || order.paymentProvider !== "PAYSTACK" || !order.providerRef) return;
  try {
    const result = await verifyPayment(order.providerRef);
    if (result.paid) await markOrderPaid(order.reference, result);
  } catch (err) {
    console.error(`Couldn't reconcile ${order.reference}:`, err);
  }
}

/**
 * The single place an order becomes paid. Idempotent: webhooks retry, and the
 * redirect-return check may race them, so only the first caller does the work.
 */
export async function markOrderPaid(reference: string, payment: { amountMinor: number; currency: string }) {
  const order = await prisma.order.findUnique({ where: { reference }, include: { items: true } });
  if (!order) {
    console.warn(`Payment for unknown order ${reference}`);
    return;
  }

  const expected = order.currency === "NGN" ? order.totalKobo : order.totalCents;
  if (payment.currency.toUpperCase() !== order.currency || payment.amountMinor < expected) {
    console.error(
      `Payment mismatch on ${reference}: got ${payment.amountMinor} ${payment.currency}, expected ${expected} ${order.currency}. Not marking paid.`,
    );
    return;
  }

  const claimed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id: order.id, paymentStatus: { not: "PAID" } },
      data: { paymentStatus: "PAID", paidAt: new Date() },
    });
    if (count === 0) return false;

    await tx.orderEvent.create({ data: { orderId: order.id, label: "Payment confirmed" } });
    for (const item of order.items) {
      if (!item.productId) continue;
      const { count: decremented } = await tx.product.updateMany({
        where: { id: item.productId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity }, unitsSold: { increment: item.quantity } },
      });
      // Oversold between checkout and payment: floor stock at zero and let the studio sort it out.
      if (decremented === 0) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: 0, unitsSold: { increment: item.quantity } } });
      }
    }
    return true;
  });
  if (!claimed) return;

  syncSalesInBackground();
  sendReceipt(order);
  notifyStudio(order);
}

/** The customer's confirmation email, sent once payment clears. */
export function sendReceipt(order: Order & { items: OrderItem[] }) {
  sendMailInBackground(
    emails.orderReceipt({
      reference: order.reference,
      name: order.name,
      email: order.email,
      totalLabel: formatPrice(order.currency === "NGN" ? order.totalKobo : order.totalCents, order.currency),
      etaDays: order.etaDays,
      lines: order.items.map((i) => ({
        name: i.name,
        detail: [i.finishLabel, i.sizeLabel].filter(Boolean).join(" · "),
        quantity: i.quantity,
      })),
    }),
  );
}

/** "Track your order" for guests: the order number plus the email it was placed with. */
export async function findOrderByReferenceAndEmail(rawReference: string, email: string) {
  const code = rawReference.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^LD/, "");
  const order = await prisma.order.findUnique({ where: { reference: `LD-${code}` }, include: orderInclude });
  if (!order || !safeEqual(order.email, email.trim().toLowerCase())) return null;
  return order;
}

/** Tells the studio a paid order is in: who bought what, and where it's going. */
export function notifyStudio(order: Order & { items: OrderItem[] }) {
  if (!env.STUDIO_EMAIL) return;
  const price = (kobo: number, cents: number) => formatPrice(order.currency === "NGN" ? kobo : cents, order.currency);
  const a = order.address as { line1: string; city: string; state: string; country: string; postcode?: string };
  sendMailInBackground(
    emails.newOrderForStudio(env.STUDIO_EMAIL, {
      reference: order.reference,
      customer: { name: order.name, email: order.email, phone: order.phone },
      address: [a.line1, a.city, a.state, a.postcode, a.country].filter(Boolean).join(", "),
      shippingMethod: order.shippingMethod,
      lines: order.items.map((i) => ({
        name: i.name,
        detail: [i.finishLabel, i.sizeLabel].filter(Boolean).join(" · "),
        quantity: i.quantity,
        unitLabel: price(i.unitKobo, i.unitCents),
        lineLabel: price(i.unitKobo * i.quantity, i.unitCents * i.quantity),
      })),
      subtotalLabel: price(order.subtotalKobo, order.subtotalCents),
      shippingLabel: order.shippingKobo || order.shippingCents ? price(order.shippingKobo, order.shippingCents) : "Free",
      totalLabel: price(order.totalKobo, order.totalCents),
      note: order.note,
    }),
  );
}

export async function findOrderForViewer(reference: string, opts: { user?: User; guestToken?: string }) {
  const order = await prisma.order.findUnique({ where: { reference }, include: orderInclude });
  if (!order) return null;
  const isOwner = opts.user && (order.userId === opts.user.id || opts.user.role === "ADMIN");
  const hasToken = opts.guestToken && safeEqual(hashToken(opts.guestToken), order.guestTokenHash);
  return isOwner || hasToken ? order : null;
}
