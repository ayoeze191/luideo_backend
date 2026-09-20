import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../../config/env.ts";
import { prisma } from "../../lib/prisma.ts";
import { serializeUser } from "../../lib/serialize.ts";
import { clearSessionCookie, currentUser, requireAuth, startSession } from "../../middleware/auth.ts";
import * as auth from "./auth.service.ts";

export const authRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { message: "Too many attempts. Please wait a few minutes.", code: "RATE_LIMITED" } },
});

const email = z.email().max(254);
const password = z.string().min(8, "Use at least 8 characters.").max(128);

authRouter.post("/register", limiter, async (req, res) => {
  const body = z
    .object({ name: z.string().trim().min(1).max(100), email, password, phone: z.string().trim().max(30).optional() })
    .parse(req.body);
  const user = await auth.register(body);
  await startSession(req, res, user.id);
  res.status(201).json({ user: serializeUser(user) });
});

authRouter.post("/login", limiter, async (req, res) => {
  const body = z.object({ email, password: z.string().min(1).max(128) }).parse(req.body);
  const user = await auth.login(body);
  await startSession(req, res, user.id);
  res.json({ user: serializeUser(user) });
});

/** Body: { credential } — the ID token from Google Identity Services. */
authRouter.post("/google", limiter, async (req, res) => {
  const { credential } = z.object({ credential: z.string().min(1) }).parse(req.body);
  const user = await auth.loginWithGoogle(credential);
  await startSession(req, res, user.id);
  res.json({ user: serializeUser(user) });
});

authRouter.post("/logout", async (req, res) => {
  if (req.sessionId) await prisma.session.delete({ where: { id: req.sessionId } }).catch(() => {});
  clearSessionCookie(res);
  res.status(204).end();
});

/** Signs out every device, including this one. */
authRouter.post("/logout-all", requireAuth, async (req, res) => {
  await prisma.session.deleteMany({ where: { userId: currentUser(req).id } });
  clearSessionCookie(res);
  res.status(204).end();
});

/** Returns { user: null } for guests rather than a 401 — the shop works signed out. */
authRouter.get("/me", (req, res) => {
  res.json({ user: req.user ? serializeUser(req.user) : null });
});

authRouter.get("/config", (_req, res) => {
  res.json({ googleClientId: env.GOOGLE_CLIENT_ID ?? null });
});

authRouter.post("/verify-email", limiter, async (req, res) => {
  const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
  const user = await auth.verifyEmail(token);
  res.json({ user: serializeUser(user) });
});

authRouter.post("/resend-verification", limiter, requireAuth, async (req, res) => {
  await auth.sendVerificationEmail(currentUser(req));
  res.status(204).end();
});

authRouter.post("/forgot-password", limiter, async (req, res) => {
  const body = z.object({ email }).parse(req.body);
  await auth.requestPasswordReset(body.email);
  res.status(204).end();
});

authRouter.post("/reset-password", limiter, async (req, res) => {
  const body = z.object({ token: z.string().min(1), password }).parse(req.body);
  await auth.resetPassword(body.token, body.password);
  clearSessionCookie(res);
  res.status(204).end();
});

/** Google-only accounts can set a first password without a current one. */
authRouter.post("/change-password", limiter, requireAuth, async (req, res) => {
  const body = z.object({ currentPassword: z.string().max(128).optional(), newPassword: password }).parse(req.body);
  const user = currentUser(req);
  await auth.changePassword(user, body.currentPassword, body.newPassword);
  // Sign out everywhere else.
  await prisma.session.deleteMany({ where: { userId: user.id, NOT: { id: req.sessionId } } });
  res.status(204).end();
});
