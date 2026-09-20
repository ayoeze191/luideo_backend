import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { allowedOrigins, isProd } from "./config/env.ts";
import { prisma } from "./lib/prisma.ts";
import { loadSession } from "./middleware/auth.ts";
import { errorHandler, notFoundHandler } from "./middleware/errors.ts";
import { originCheck } from "./middleware/origin-check.ts";
import { accountRouter } from "./modules/account/account.routes.ts";
import { adminRouter } from "./modules/admin/admin.routes.ts";
import { alertsRouter } from "./modules/alerts/alerts.routes.ts";
import { authRouter } from "./modules/auth/auth.routes.ts";
import { catalogRouter } from "./modules/catalog/catalog.routes.ts";
import { contactRouter } from "./modules/contact/contact.routes.ts";
import { ordersRouter } from "./modules/orders/orders.routes.ts";
import { webhooksRouter } from "./modules/payments/webhooks.routes.ts";
import { UPLOAD_DIR } from "./modules/uploads/uploads.ts";

export function createApp() {
  const app = express();

  // Behind Render/Railway/Fly/Nginx: trust the first proxy so req.ip and secure cookies work.
  if (isProd) app.set("trust proxy", 1);

  // Images under /uploads are loaded by the storefront on another origin.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
      credentials: true,
    }),
  );

  // Webhooks need the raw body for signature checks, so they come before express.json().
  app.use("/api/webhooks", webhooksRouter);

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(originCheck);
  app.use(loadSession);

  app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d", immutable: true, fallthrough: false }));

  app.get("/api/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });

  app.use("/api/auth", authRouter);
  app.use("/api", catalogRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/me", accountRouter);
  app.use("/api/alerts", alertsRouter);
  app.use("/api/contact", contactRouter);
  app.use("/api/admin", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
