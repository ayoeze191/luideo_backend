import express, { Router } from "express";
import { env } from "../../config/env.ts";
import { safeEqual } from "../../lib/tokens.ts";
import { markOrderPaid } from "../orders/orders.service.ts";
import { verifyById } from "./flutterwave.ts";

/**
 * Flutterwave webhook. Every call carries the secret hash set in the
 * Flutterwave dashboard in a `verif-hash` header; anything without it isn't
 * from Flutterwave. Even then we re-verify the transaction with Flutterwave
 * before marking anything paid — the webhook only tells us where to look.
 */
export const webhooksRouter = Router();
webhooksRouter.use(express.raw({ type: "*/*", limit: "1mb" }));

webhooksRouter.post("/flutterwave", async (req, res) => {
  const hash = req.get("verif-hash");
  if (!env.FLW_SECRET_HASH || !hash || !safeEqual(hash, env.FLW_SECRET_HASH) || !Buffer.isBuffer(req.body)) {
    res.status(401).end();
    return;
  }

  let event: { event?: string; data?: { id?: number | string; status?: string } };
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    res.status(400).end();
    return;
  }

  if (event.event === "charge.completed" && event.data?.id != null) {
    try {
      const result = await verifyById(event.data.id);
      if (result.paid && result.orderReference) await markOrderPaid(result.orderReference, result);
    } catch (err) {
      // A 200 stops Flutterwave retrying; let it retry if we couldn't check.
      console.error("Flutterwave webhook: couldn't verify transaction", event.data.id, err);
      res.status(500).end();
      return;
    }
  }
  res.status(200).end();
});
