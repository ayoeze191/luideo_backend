import { Router } from "express";
import { z } from "zod";
import { env, isProd } from "../../config/env.ts";
import { notFound } from "../../lib/http-error.ts";
import { prisma } from "../../lib/prisma.ts";
import { randomToken, safeEqual } from "../../lib/tokens.ts";
import { currentUser } from "../../middleware/auth.ts";
import { exchangeCode, loginDialogUrl } from "./meta.ts";
import * as social from "./social.service.ts";

/** Mounted under /api/admin/social, so every route here is admin-only. */
export const socialRouter = Router();

const STATE_COOKIE = "luideo_meta_state";
const back = (query: string) => `${env.FRONTEND_URL}/admin/social?${query}`;

socialRouter.get("/status", async (_req, res) => {
  res.json(await social.connectionStatus());
});

/** Browser navigates here; we bounce to Facebook's login dialog. */
socialRouter.get("/connect", (_req, res) => {
  const state = randomToken();
  res.cookie(STATE_COOKIE, state, { httpOnly: true, secure: isProd, sameSite: "lax", maxAge: 10 * 60 * 1000, path: "/api/admin/social" });
  res.redirect(loginDialogUrl(state));
});

/** Facebook sends the admin back here with ?code&state. */
socialRouter.get("/callback", async (req, res) => {
  const { code, state, error_description } = req.query as Record<string, string | undefined>;
  const expected = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: "/api/admin/social" });

  if (error_description) return res.redirect(back(`error=${encodeURIComponent(error_description)}`));
  if (!code || !state || typeof expected !== "string" || !safeEqual(state, expected)) {
    return res.redirect(back("error=The+connection+request+expired.+Please+try+again."));
  }

  try {
    const { token, expiresAt } = await exchangeCode(code);
    const pages = await social.saveUserToken(token, expiresAt, currentUser(req).id);
    if (pages === 0) return res.redirect(back("error=This+Facebook+account+doesn't+manage+any+Pages."));
    res.redirect(back(pages === 1 ? "connected=1" : "choose=1"));
  } catch (err) {
    console.error("Meta OAuth callback failed:", err);
    res.redirect(back(`error=${encodeURIComponent(err instanceof Error ? err.message : "Connection failed")}`));
  }
});

socialRouter.get("/pages", async (_req, res) => {
  res.json({ pages: await social.pagesToChoose() });
});

socialRouter.post("/pages", async (req, res) => {
  const { pageId } = z.object({ pageId: z.string().min(1) }).parse(req.body);
  await social.choosePage(pageId);
  res.json(await social.connectionStatus());
});

socialRouter.post("/disconnect", async (_req, res) => {
  await social.disconnect();
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

/** Post (or schedule) to any mix of Instagram/Facebook feed and stories. */
socialRouter.post("/posts", async (req, res) => {
  const body = postSchema.parse(req.body);
  if ((body.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) {
    return res.status(400).json({ error: { message: "Instagram allows at most 30 hashtags.", code: "HASHTAGS" } });
  }

  const product = body.productId ? await prisma.product.findUnique({ where: { id: body.productId } }) : null;
  if (body.productId && !product) throw notFound("Product not found.");
  const imageUrl = body.imageUrl ?? product?.photo ?? undefined;
  if (!imageUrl) return res.status(400).json({ error: { message: "Add a photo — Instagram and Facebook posts need an image.", code: "NO_IMAGE" } });

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
