import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.ts";

/** A URL-safe random token for sessions, email links and guest order access. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Tokens are stored hashed. HMAC with the session secret means a leaked
 * database alone can't be used to forge or replay them.
 */
export function hashToken(token: string) {
  return createHmac("sha256", env.SESSION_SECRET).update(token).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function sha512Hmac(secret: string, payload: Buffer | string) {
  return createHmac("sha512", secret).update(payload).digest("hex");
}

/**
 * A short-lived signed pass: `<payload>.<expiry>.<signature>`. For steps where
 * the browser navigates to the API directly, and so may not send the session
 * cookie (browsers partition cookies set by a site on another domain).
 */
export function signTicket(payload: string, ttlSeconds: number) {
  const body = `${Buffer.from(payload).toString("base64url")}.${Math.floor(Date.now() / 1000) + ttlSeconds}`;
  return `${body}.${createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url")}`;
}

/** The payload of a valid, unexpired ticket, or null. */
export function verifyTicket(ticket: string): string | null {
  const [payload, expiry, signature] = ticket.split(".");
  if (!payload || !expiry || !signature) return null;
  const expected = createHmac("sha256", env.SESSION_SECRET).update(`${payload}.${expiry}`).digest("base64url");
  if (!safeEqual(signature, expected) || Number(expiry) < Date.now() / 1000) return null;
  return Buffer.from(payload, "base64url").toString();
}

/** Short, unambiguous order reference: LD-7K3M9Q (no 0/O/1/I). */
export function orderReference() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(6);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `LD-${out}`;
}

