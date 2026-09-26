import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { PAYMENT_METHODS } from "../../lib/catalog.ts";
import { notFound } from "../../lib/http-error.ts";
import { serializeOrder } from "../../lib/serialize.ts";
import * as orders from "./orders.service.ts";

/** Checkout. Works signed in or as a guest — an account is never required to buy. */
export const ordersRouter = Router();

const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { message: "Too many checkout attempts. Please wait a few minutes.", code: "RATE_LIMITED" } },
});

const line = z.string().trim().min(1).max(200);

const checkoutSchema = z.object({
  email: z.email().max(254),
  name: line,
  phone: z.string().trim().min(5).max(30),
  address: z.object({
    line1: line,
    city: line,
    state: line,
    country: line,
    postcode: z.string().trim().max(20).optional(),
  }),
  shippingMethodId: z.string(),
  paymentMethod: z.enum(PAYMENT_METHODS.map((m) => m.id) as [(typeof PAYMENT_METHODS)[number]["id"]]),
  currency: z.enum(["NGN", "USD"]),
  items: z
    .array(
      z.object({
        productId: z.string(),
        finishId: z.string(),
        sizeId: z.string().optional(),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1, "Your bag is empty.")
    .max(30),
  /** "Email me when something similar to this comes in." */
  notifySimilar: z.boolean().default(false),
  note: z.string().trim().max(1000).optional(),
  /** Written on the card in the box. */
  giftMessage: z.string().trim().max(300).optional(),
});

/**
 * Creates the order and returns the Paystack URL to send the customer to.
 * Nothing is made or emailed about until that payment clears. Keep `guestToken` (e.g. in sessionStorage): it's
 * what lets a guest open their confirmation page.
 */
ordersRouter.post("/", checkoutLimiter, async (req, res) => {
  const input = checkoutSchema.parse(req.body);
  const { order, guestToken } = await orders.createOrder(input, req.user);
  // If the provider hiccups, the order still exists — return it with the error
  // so the page can offer "try again" via POST /:reference/pay.
  try {
    const paymentUrl = await orders.startPayment(order, guestToken);
    res.status(201).json({ order: serializeOrder(order), guestToken, paymentUrl });
  } catch (err) {
    console.error(`Payment start failed for ${order.reference}:`, err);
    res.status(201).json({
      order: serializeOrder(order),
      guestToken,
      paymentUrl: null,
      paymentError: "We couldn't reach the payment provider. Please try again.",
    });
  }
});

const trackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { message: "Too many tries. Please wait a few minutes and try again.", code: "RATE_LIMITED" } },
});

/**
 * Track an order without an account. POST so the email stays out of URLs and
 * server logs. The same answer for a wrong number or a wrong email, so it
 * can't be used to find out which order numbers exist.
 */
ordersRouter.post("/track", trackLimiter, async (req, res) => {
  const { reference, email } = z
    .object({ reference: z.string().trim().min(3).max(40), email: z.string().trim().min(3).max(254) })
    .parse(req.body);
  let order = await orders.findOrderByReferenceAndEmail(reference, email);
  if (!order) throw notFound("We couldn't find an order with that number and email. Check both and try again.");

  if (order.paymentStatus === "AWAITING") {
    await orders.reconcilePayment(order);
    order = (await orders.findOrderByReferenceAndEmail(order.reference, order.email))!;
  }
  res.json({ order: serializeOrder(order) });
});

/**
 * The confirmation page. Signed-in owners need nothing extra; guests pass
 * ?token=. If payment is still pending we check with the provider directly,
 * so the page is right even when the webhook hasn't landed yet.
 */
ordersRouter.get("/:reference", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : undefined;
  let order = await orders.findOrderForViewer(req.params.reference, { user: req.user, guestToken: token });
  if (!order) throw notFound("We couldn't find that order.");

  if (order.paymentStatus === "AWAITING") {
    await orders.reconcilePayment(order);
    order = (await orders.findOrderForViewer(order.reference, { user: req.user, guestToken: token }))!;
  }
  res.json({ order: serializeOrder(order) });
});

/** Retry payment for an unpaid order (e.g. the customer closed the Paystack window). */
ordersRouter.post("/:reference/pay", checkoutLimiter, async (req, res) => {
  const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
  const order = await orders.findOrderForViewer(String(req.params.reference), { guestToken: token });
  if (!order) throw notFound("We couldn't find that order.");
  const paymentUrl = await orders.startPayment(order, token);
  res.json({ paymentUrl });
});
