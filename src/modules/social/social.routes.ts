import { Router } from "express";
import { z } from "zod";
import { env, isProd } from "../../config/env.ts";
import { notFound } from "../../lib/http-error.ts";
import { prisma } from "../../lib/prisma.ts";
import { safeEqual, signTicket, verifyTicket } from "../../lib/tokens.ts";
import { currentUser } from "../../middleware/auth.ts";
import { PROVIDER_NAME, exchangeCode, isConfigured, loginUrl, type Provider } from "./platforms.ts";
import * as social from "./social.service.ts";

/** Mounted under /api/admin/social, so every route here is admin-only. */
export const socialRouter = Router();

const STATE_COOKIE = "luideo_social_state";
const back = (query: string) => `${env.FRONTEND_URL}/admin/social?${query}`;
const provider = z.enum(["instagram", "threads"]);

socialRouter.get("/status", async (_req, res) => {
  res.json(await social.connectionStatus());
});

/**
 * Step one of connecting: a signed-in admin asks (with their session) for a
 * one-time link, then the browser opens it. See socialOAuthRouter below.
 */
socialRouter.post("/connect-link", (req, res) => {
  const { provider: p } = z.object({ provider }).parse(req.body);
  const ticket = signTicket(`${currentUser(req).id}:${p}`, 2 * 60);
  res.json({ url: `${env.API_URL}/api/admin/social/connect?ticket=${encodeURIComponent(ticket)}` });
});

socialRouter.post("/disconnect", async (req, res) => {
  const { provider: p } = z.object({ provider }).parse(req.body);
  await social.disconnect(p);
  res.status(204).end();
});

const postSchema = z.object({
  productId: z.string().optional(),
  imageUrl: z.string().min(1).optional(),
  caption: z.string().max(2200).default(""),
  targets: z.array(z.enum(Object.keys(social.TARGET_IDS) as [string, ...string[]])).min(1),
  /** ISO timestamp; omit to post now. */
  scheduledAt: z.coerce.date().optional(),
});

/** Post (or schedule) to any mix of Instagram feed, Instagram story and Threads. */
socialRouter.post("/posts", async (req, res) => {
  const body = postSchema.parse(req.body);
  if ((body.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) {
    return res.status(400).json({ error: { message: "Instagram allows at most 30 hashtags.", code: "HASHTAGS" } });
  }

  const product = body.productId ? await prisma.product.findUnique({ where: { id: body.productId } }) : null;
  if (body.productId && !product) throw notFound("Product not found.");
  const imageUrl = body.imageUrl ?? product?.photo ?? undefined;
  if (!imageUrl) return res.status(400).json({ error: { message: "Add a photo — Instagram and Threads posts need an image.", code: "NO_IMAGE" } });

  const scheduledAt = body.scheduledAt && body.scheduledAt.getTime() > Date.now() + 60_000 ? body.scheduledAt : undefined;
  const posts = await social.createPosts({
    productId: product?.id,
    imageUrl,
    caption: body.caption,
    link: product ? `${env.FRONTEND_URL}/product/${product.slug}` : undefined,
    targets: body.targets.map((t) => social.TARGET_IDS[t]!),
    scheduledAt,
  });
  res.status(201).json({ outcomes: posts.map(social.outcome) });
});

socialRouter.get("/posts", async (_req, res) => {
  const posts = await prisma.socialPost.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { product: { select: { name: true, slug: true } } },
  });
  res.json({
    posts: posts.map((p) => ({
      ...social.outcome(p),
      state: p.status,
      imageUrl: p.imageUrl,
      caption: p.caption,
      productName: p.product?.name ?? null,
      productSlug: p.product?.slug ?? null,
      scheduledAt: p.scheduledAt?.toISOString() ?? null,
      postedAt: p.postedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
  });
});

socialRouter.post("/posts/:id/retry", async (req, res) => {
  res.json({ outcome: social.outcome(await social.retry(req.params.id)) });
});

/** Cancel a scheduled post that hasn't gone out yet. */
socialRouter.delete("/posts/:id", async (req, res) => {
  const { count } = await prisma.socialPost.deleteMany({ where: { id: req.params.id, status: "SCHEDULED" } });
  if (!count) throw notFound("No scheduled post with that id.");
  res.status(204).end();
});

/**
 * The two steps of logging in that the browser opens directly: the admin's
 * session cookie may not come along (it was set cross-site), so these are
 * mounted outside requireAdmin and identify the admin by a signed ticket.
 */
export const socialOAuthRouter = Router();

/** "<adminId>:<provider>" from a signed ticket or state, or null. */
function readSigned(value: string) {
  const payload = verifyTicket(value);
  const [adminId, p] = payload?.split(":") ?? [];
  const parsed = provider.safeParse(p);
  return adminId && parsed.success ? { adminId, provider: parsed.data } : null;
}

/** Opened with the ticket from /connect-link; bounces to Instagram's or Threads' login. */
socialOAuthRouter.get("/connect", async (req, res) => {
  const signed = readSigned(String(req.query.ticket ?? ""));
  const admin = signed ? await prisma.user.findUnique({ where: { id: signed.adminId } }) : null;
  if (!signed || admin?.role !== "ADMIN") {
    return res.redirect(back("error=That+link+has+expired.+Click+Connect+again."));
  }
  if (!isConfigured(signed.provider)) {
    return res.redirect(back(`error=${encodeURIComponent(`${PROVIDER_NAME[signed.provider]} isn't set up on the server yet.`)}`));
  }
  // The state carries who and which platform, signed; the cookie ties it to this browser.
  const state = signTicket(`${admin.id}:${signed.provider}`, 10 * 60);
  res.cookie(STATE_COOKIE, state, { httpOnly: true, secure: isProd, sameSite: "lax", maxAge: 10 * 60 * 1000, path: "/api/admin/social" });
  res.redirect(loginUrl(signed.provider, state));
});

/** Instagram and Threads both send the admin back here with ?code&state. */
socialOAuthRouter.get("/callback", async (req, res) => {
  const { code, state, error_description, error_reason } = req.query as Record<string, string | undefined>;
  const expected = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: "/api/admin/social" });

  if (error_description || error_reason) {
    return res.redirect(back(`error=${encodeURIComponent(error_description ?? "The connection was cancelled.")}`));
  }
  const signed = state && typeof expected === "string" && safeEqual(state, expected) ? readSigned(state) : null;
  if (!code || !signed) return res.redirect(back("error=The+connection+request+expired.+Please+try+again."));

  try {
    // Instagram appends "#_" to the code; it isn't part of it.
    const { token, expiresAt } = await exchangeCode(signed.provider, code.replace(/#_$/, ""));
    await social.saveConnection(signed.provider, token, expiresAt, signed.adminId);
    res.redirect(back(`connected=${signed.provider}`));
  } catch (err) {
    console.error(`${signed.provider} login callback failed:`, err);
    res.redirect(back(`error=${encodeURIComponent(err instanceof Error ? err.message : "Connection failed")}`));
  }
});
