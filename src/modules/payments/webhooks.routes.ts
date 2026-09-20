import express, { Router } from "express";
import { env } from "../../config/env.ts";
import { safeEqual, sha512Hmac } from "../../lib/tokens.ts";
import { markOrderPaid } from "../orders/orders.service.ts";
import { verifyPayment } from "./paystack.ts";

/**
 * Paystack webhook. Mounted before express.json() — the signature is an
 * HMAC over the exact raw bytes. Even with a valid signature we re-verify the
 * transaction with Paystack before marking anything paid.
 */
export const webhooksRouter = Router();
webhooksRouter.use(express.raw({ type: "*/*", limit: "1mb" }));

webhooksRouter.post("/paystack", async (req, res) => {
  const signature = req.get("x-paystack-signature");
  if (!env.PAYSTACK_SECRET_KEY || !signature || !Buffer.isBuffer(req.body) || !safeEqual(sha512Hmac(env.PAYSTACK_SECRET_KEY, req.body), signature)) {
    res.status(401).end();
    return;
  }

  const event = JSON.parse(req.body.toString("utf8")) as { event: string; data: { reference: string } };
  if (event.event === "charge.success") {
    const result = await verifyPayment(event.data.reference);
    // Attempt references look like LD-7K3M9Q-abc123; the order reference is the metadata, or the prefix.
    const reference = result.orderReference ?? event.data.reference.replace(/-[A-Za-z0-9_-]{6}$/, "");
    if (result.paid) await markOrderPaid(reference, result);
  }
  res.status(200).end();
});
