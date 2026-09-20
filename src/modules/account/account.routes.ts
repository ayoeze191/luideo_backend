import { Router } from "express";
import { z } from "zod";
import { COLLECTIONS } from "../../lib/catalog.ts";
import { notFound } from "../../lib/http-error.ts";
import { prisma } from "../../lib/prisma.ts";
import { serializeOrder, serializeProduct, serializeUser } from "../../lib/serialize.ts";
import { currentUser, requireAuth } from "../../middleware/auth.ts";
import * as alerts from "../alerts/alerts.service.ts";

/** Everything under /api/me requires a signed-in customer. */
export const accountRouter = Router();
accountRouter.use(requireAuth);

/* ------------------------------------------------------------ Profile */

accountRouter.patch("/", async (req, res) => {
  const body = z
    .object({ name: z.string().trim().min(1).max(100).optional(), phone: z.string().trim().max(30).nullable().optional() })
    .parse(req.body);
  const user = await prisma.user.update({ where: { id: currentUser(req).id }, data: body });
  res.json({ user: serializeUser(user) });
});

/* ------------------------------------------------------------ Orders */

const orderInclude = { items: true, events: true } as const;

accountRouter.get("/orders", async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: currentUser(req).id },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json({ orders: orders.map((o) => serializeOrder(o)) });
});

accountRouter.get("/orders/:reference", async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { reference: req.params.reference, userId: currentUser(req).id },
    include: orderInclude,
  });
  if (!order) throw notFound("We couldn't find that order on your account.");
  res.json({ order: serializeOrder(order) });
});

/* ------------------------------------------------------------ Wishlist */

accountRouter.get("/wishlist", async (req, res) => {
  const items = await prisma.wishlistItem.findMany({
    where: { userId: currentUser(req).id, product: { published: true } },
    include: { product: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ productIds: items.map((i) => i.productId), products: items.map((i) => serializeProduct(i.product)) });
});

accountRouter.put("/wishlist/:productId", async (req, res) => {
  const userId = currentUser(req).id;
  const { productId } = req.params;
  const product = await prisma.product.findFirst({ where: { id: productId, published: true } });
  if (!product) throw notFound("That piece isn't available.");
  await prisma.wishlistItem.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId },
    update: {},
  });
  res.status(204).end();
});

accountRouter.delete("/wishlist/:productId", async (req, res) => {
  await prisma.wishlistItem.deleteMany({ where: { userId: currentUser(req).id, productId: req.params.productId } });
  res.status(204).end();
});

/** Merge a guest's localStorage wishlist into their account after they sign in. */
accountRouter.post("/wishlist/merge", async (req, res) => {
  const { productIds } = z.object({ productIds: z.array(z.string()).max(200) }).parse(req.body);
  const userId = currentUser(req).id;
  const valid = await prisma.product.findMany({ where: { id: { in: productIds }, published: true }, select: { id: true } });
  await prisma.wishlistItem.createMany({ data: valid.map((p) => ({ userId, productId: p.id })), skipDuplicates: true });
  const items = await prisma.wishlistItem.findMany({ where: { userId }, select: { productId: true } });
  res.json({ productIds: items.map((i) => i.productId) });
});

/* ------------------------------------------------------------ New-piece alerts */

accountRouter.get("/alerts", async (req, res) => {
  res.json({ preferences: await alerts.getPreferences(currentUser(req)) });
});

accountRouter.put("/alerts", async (req, res) => {
  const categories = await prisma.category.findMany({ select: { slug: true } });
  const body = z
    .object({
      enabled: z.boolean(),
      similarToPurchases: z.boolean(),
      categories: z.array(z.enum(categories.map((c) => c.slug) as [string, ...string[]])).max(20),
      collections: z.array(z.enum(COLLECTIONS)).max(20),
    })
    .partial()
    .parse(req.body);
  res.json({ preferences: await alerts.setPreferences(currentUser(req), body) });
});

/** The in-app notification feed. */
accountRouter.get("/notifications", async (req, res) => {
  const where = { subscription: { userId: currentUser(req).id } };
  const [items, unread] = await Promise.all([
    prisma.productAlert.findMany({
      where: { ...where, product: { published: true } },
      include: { product: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.productAlert.count({ where: { ...where, readAt: null, product: { published: true } } }),
  ]);
  res.json({
    unread,
    notifications: items.map((a) => ({
      id: a.id,
      reason: a.reason,
      read: a.readAt != null,
      createdAt: a.createdAt.toISOString(),
      product: serializeProduct(a.product),
    })),
  });
});

/** Body: { ids: [...] } to mark some, or {} to mark all read. */
accountRouter.post("/notifications/read", async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string()).max(200).optional() }).parse(req.body ?? {});
  await prisma.productAlert.updateMany({
    where: { subscription: { userId: currentUser(req).id }, readAt: null, ...(ids && { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
  res.status(204).end();
});
