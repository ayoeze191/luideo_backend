import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";

/* ------------------------------------------------------------------ *
 * Where customers send manual USD payments (Zelle, Cash App, Apple Cash, U.S.
 * domestic wire). The studio edits these from the admin's "Payment
 * details" page; checkout shows them after a manual-payment order is
 * placed. A method with its fields left empty isn't shown.
 * ------------------------------------------------------------------ */

const KEY = "payment-details";
const text = z.string().trim().max(200).default("");

export const paymentDetailsSchema = z.object({
  zelle: z.object({ name: text, contact: text }).default({ name: "", contact: "" }),
  cashApp: z.object({ name: text, cashtag: text }).default({ name: "", cashtag: "" }),
  appleCash: z.object({ name: text, contact: text }).default({ name: "", contact: "" }),
  wire: z
    .object({ accountName: text, bankName: text, accountNumber: text, routingNumber: text, bankAddress: text })
    .default({ accountName: "", bankName: "", accountNumber: "", routingNumber: "", bankAddress: "" }),
  /** Extra instructions shown under the details. */
  note: z.string().trim().max(1000).default(""),
});

export type PaymentDetails = z.infer<typeof paymentDetailsSchema>;

export async function getPaymentDetails(): Promise<PaymentDetails & { updatedAt: string | null }> {
  const row = await prisma.storeSetting.findUnique({ where: { key: KEY } });
  // Parsing fills in any field added since the details were last saved.
  const details = paymentDetailsSchema.parse(row?.value ?? {});
  return { ...details, updatedAt: row?.updatedAt.toISOString() ?? null };
}

/** Mounted at /api/payment-details: read by checkout. */
export const paymentDetailsRouter = Router();

paymentDetailsRouter.get("/", async (_req, res) => {
  res.json({ details: await getPaymentDetails() });
});

/** Mounted at /api/admin/payment-details, behind the "payments" area. */
export const adminPaymentDetailsRouter = Router();

adminPaymentDetailsRouter.get("/", async (_req, res) => {
  res.json({ details: await getPaymentDetails() });
});

adminPaymentDetailsRouter.put("/", async (req, res) => {
  const value = paymentDetailsSchema.parse(req.body);
  await prisma.storeSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  res.json({ details: await getPaymentDetails() });
});
