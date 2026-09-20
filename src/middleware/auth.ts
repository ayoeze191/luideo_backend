import type { CookieOptions, NextFunction, Request, Response } from "express";
import { env, isProd } from "../config/env.ts";
import type { User } from "../generated/prisma/client.ts";
import { forbidden, unauthorized } from "../lib/http-error.ts";
import { prisma } from "../lib/prisma.ts";
import { hashToken, randomToken } from "../lib/tokens.ts";

export const SESSION_COOKIE = "luideo_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
    }
  }
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd || env.COOKIE_SAMESITE === "none",
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN,
    path: "/",
  };
}

/** Creates a session and sets the httpOnly cookie. The token itself never reaches page JavaScript. */
export async function startSession(req: Request, res: Response, userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      userAgent: req.get("user-agent")?.slice(0, 255),
      ip: req.ip,
    },
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), expires: expiresAt });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/**
 * Attaches req.user when a valid session is present. Never rejects — guests
 * are welcome on most routes. Use requireAuth / requireAdmin to gate.
 */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || !token) return next();

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return next();

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return next();
  }

  req.user = session.user;
  req.sessionId = session.id;
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  if (req.user.role !== "ADMIN") throw forbidden();
  next();
}

/** Narrowing helper for handlers behind requireAuth. */
export function currentUser(req: Request): User {
  if (!req.user) throw unauthorized();
  return req.user;
}
