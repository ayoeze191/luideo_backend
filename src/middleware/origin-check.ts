import type { NextFunction, Request, Response } from "express";
import { allowedOrigins } from "../config/env.ts";
import { forbidden } from "../lib/http-error.ts";
import { SESSION_COOKIE } from "./auth.ts";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard. A state-changing request that carries the session cookie must
 * come from one of our own origins. Requests without the cookie (webhooks,
 * one-click unsubscribe) aren't riding on ambient credentials, so they pass.
 */
export function originCheck(req: Request, _res: Response, next: NextFunction) {
  if (SAFE.has(req.method) || !req.cookies?.[SESSION_COOKIE]) return next();

  const origin = req.get("origin") ?? refererOrigin(req.get("referer"));
  if (!origin || !allowedOrigins.includes(origin)) {
    throw forbidden("Request origin not allowed.");
  }
  next();
}

function refererOrigin(referer?: string) {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
