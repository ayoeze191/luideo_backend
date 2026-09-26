import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../../config/env.ts";
import * as emails from "../../emails/templates.ts";
import { sendMailInBackground } from "../../lib/mailer.ts";
import { prisma } from "../../lib/prisma.ts";

export const contactRouter = Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { message: "You've sent a few messages already — we'll be in touch soon.", code: "RATE_LIMITED" } },
});

contactRouter.post("/", limiter, async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(100),
      email: z.email().max(254),
      subject: z.string().trim().min(1).max(100),
      message: z.string().trim().min(1).max(5000),
    })
    .parse(req.body);

  await prisma.contactMessage.create({ data: body });
  if (env.STUDIO_EMAIL) sendMailInBackground(emails.contactToStudio(env.STUDIO_EMAIL, body));
  sendMailInBackground(emails.contactReceived(body));
  res.status(201).json({ ok: true });
});
