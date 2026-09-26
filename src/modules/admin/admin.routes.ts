import { Router } from "express";
import { z } from "zod";
import * as emails from "../../emails/templates.ts";
import { Prisma, type OrderStatus } from "../../generated/prisma/client.ts";
import { BADGES, COLLECTIONS, MATERIALS, ORDER_STATUS_LABEL } from "../../lib/catalog.ts";
import { badRequest, notFound } from "../../lib/http-error.ts";
import { sendMailInBackground } from "../../lib/mailer.ts";
import { money, toMinor } from "../../lib/money.ts";
import { prisma } from "../../lib/prisma.ts";
import { serializeCategory, serializeOrder, serializeProduct } from "../../lib/serialize.ts";
import { requireAdmin } from "../../middleware/auth.ts";
import { notifyForNewProductInBackground } from "../alerts/alerts.service.ts";
import { markOrderPaid, orderInclude } from "../orders/orders.service.ts";
import { socialRouter } from "../social/social.routes.ts";
import { uploadsRouter } from "../uploads/uploads.ts";
import { dashboardStats } from "./stats.ts";

export const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.use("/social", socialRouter);
adminRouter.use("/uploads", uploadsRouter);

adminRouter.get("/stats", async (_req, res) => {
  res.json(await dashboardStats());
});

/* ------------------------------------------------------------ Products */

const variant = z.object({
  id: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  swatch: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  inStock: z.boolean().default(true),
});
const moneyInput = z.object({ ngn: z.number().nonnegative(), usd: z.number().nonnegative() });

const productSchema = z.object({
  /** Generated from the name when omitted. */
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lower-case words separated by hyphens.").max(120).optional(),
  name: z.string().trim().min(1).max(160),
  tagline: z.string().trim().max(200).default(""),
  category: z.string(),
  collection: z.enum(COLLECTIONS),
  material: z.enum(MATERIALS),
  price: moneyInput,
  /** The original price, shown struck through, when the piece is on discount. `price` is what's charged. */
  compareAt: moneyInput.nullable().optional(),
  photo: z.string().trim().max(200).nullable().optional(),
  /** Defaults to a single "As pictured" option. */
  finishes: z.array(variant).min(1).default([{ id: "as-pictured", label: "As pictured", inStock: true }]),
  sizes: z.array(variant).nullable().optional(),
  sizeLabel: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(5000).default(""),
  details: z.array(z.string().trim().max(300)).max(30).default([]),
  care: z.array(z.string().trim().max(300)).max(30).default([]),
  badge: z.enum(BADGES).nullable().optional(),
  stock: z.number().int().min(0).default(0),
  /** Generated (LD-COR-019) when omitted. */
  sku: z.string().trim().min(1).max(60).optional(),
  madeToOrderDays: z.number().int().min(0).max(365).default(14),
  published: z.boolean().default(true),
});

type ProductInput = z.infer<typeof productSchema>;

/** A discount only makes sense if the original price is higher than what's charged, in both currencies. */
function assertDiscount(price: { ngn: number; usd: number }, compareAt: { ngn: number; usd: number } | null | undefined) {
  if (compareAt && (compareAt.ngn <= price.ngn || compareAt.usd <= price.usd)) {
    throw badRequest("The discounted price must be lower than the original price, in both ₦ and $.", "DISCOUNT");
  }
}

/** API shape → columns. Only fields present in the input are returned, so it serves PATCH too. */
function productColumns<T extends Partial<ProductInput>>(input: T) {
  const { price, compareAt, category, sizes, ...rest } = input;
  return {
    ...rest,
    ...(category !== undefined && { categorySlug: category }),
    ...(price && { priceKobo: toMinor(price.ngn), priceCents: toMinor(price.usd) }),
    ...(compareAt !== undefined && {
      compareAtKobo: compareAt ? toMinor(compareAt.ngn) : null,
      compareAtCents: compareAt ? toMinor(compareAt.usd) : null,
    }),
    ...(sizes !== undefined && { sizes: sizes ?? Prisma.DbNull }),
  };
}

async function uniqueSlug(name: string) {
  const base =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Ìyàwó → Iyawo
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "piece";
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await prisma.product.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
}

async function nextSku(category: string) {
  for (let n = (await prisma.product.count()) + 1; ; n++) {
    const sku = `LD-${category.slice(0, 3).toUpperCase()}-${String(n).padStart(3, "0")}`;
    if (!(await prisma.product.findUnique({ where: { sku }, select: { id: true } }))) return sku;
  }
}

async function assertCategory(slug?: string) {
  if (slug && !(await prisma.category.findUnique({ where: { slug } }))) {
    throw badRequest(`Unknown category "${slug}".`, "CATEGORY");
  }
}

adminRouter.get("/products", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const products = await prisma.product.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { createdAt: "desc" },
  });
  res.json({ products: products.map(serializeProduct) });
});

adminRouter.get("/products/:id", async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) throw notFound();
  res.json({ product: serializeProduct(product) });
});

/** Publishing a new product emails everyone who bought or follows something similar. */
adminRouter.post("/products", async (req, res) => {
  const input = productSchema.parse(req.body);
  await assertCategory(input.category);
  assertDiscount(input.price, input.compareAt);
  const product = await prisma.product.create({
    data: {
      ...productColumns(input),
      slug: input.slug ?? (await uniqueSlug(input.name)),
      sku: input.sku ?? (await nextSku(input.category)),
      categorySlug: input.category,
      priceKobo: toMinor(input.price.ngn),
      priceCents: toMinor(input.price.usd),
    },
  });
  if (product.published) notifyForNewProductInBackground(product.id);
  res.status(201).json({ product: serializeProduct(product) });
});

adminRouter.patch("/products/:id", async (req, res) => {
  const input = productSchema.partial().parse(req.body);
  await assertCategory(input.category);
  if (input.price || input.compareAt) {
    const current = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!current) throw notFound();
    const compareAt = input.compareAt !== undefined ? input.compareAt : serializeProduct(current).compareAt;
    assertDiscount(input.price ?? serializeProduct(current).price, compareAt);
  }
  const product = await prisma.product.update({ where: { id: req.params.id }, data: productColumns(input) });
  // First publish of a draft sends alerts; later edits don't (alertsSentAt guards it).
  if (product.published && !product.alertsSentAt) notifyForNewProductInBackground(product.id);
  res.json({ product: serializeProduct(product) });
});

/** Archive rather than delete — past orders still point at it. */
adminRouter.delete("/products/:id", async (req, res) => {
  await prisma.product.update({ where: { id: req.params.id }, data: { published: false } });
  res.status(204).end();
});

/* ------------------------------------------------------------ Categories */

const categorySchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  name: z.string().trim().min(1).max(80),
  blurb: z.string().trim().max(300).default(""),
  photo: z.string().trim().max(200).nullable().optional(),
  sortOrder: z.number().int().default(0),
});

adminRouter.post("/categories", async (req, res) => {
  const category = await prisma.category.create({ data: categorySchema.parse(req.body) });
  res.status(201).json({ category: serializeCategory(category) });
});

adminRouter.patch("/categories/:slug", async (req, res) => {
  const { slug: _, ...data } = categorySchema.partial().parse(req.body);
  const category = await prisma.category.update({ where: { slug: req.params.slug }, data });
  res.json({ category: serializeCategory(category) });
});

/* ------------------------------------------------------------ Orders */

const STATUS_BY_LABEL = Object.fromEntries(Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => [v, k])) as Record<string, OrderStatus>;

adminRouter.get("/orders", async (req, res) => {
  const q = z
    .object({
      status: z.enum(Object.keys(ORDER_STATUS_LABEL) as [OrderStatus]).optional(),
      payment: z.enum(["AWAITING", "PAID", "FAILED", "REFUNDED"]).optional(),
      q: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    })
    .parse(req.query);

  const where: Prisma.OrderWhereInput = {
    ...(q.status && { status: q.status }),
    ...(q.payment && { paymentStatus: q.payment }),
    ...(q.q && {
      OR: [
        { reference: { contains: q.q, mode: "insensitive" } },
        { email: { contains: q.q, mode: "insensitive" } },
        { name: { contains: q.q, mode: "insensitive" } },
      ],
    }),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  res.json({ orders: rows.map((o) => serializeOrder(o, { internal: true })), total, page: q.page, pageSize: q.pageSize });
});

adminRouter.get("/orders/:id", async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id: req.params.id }, { reference: req.params.id }] },
    include: orderInclude,
  });
  if (!order) throw notFound();
  const [paid, account] = await Promise.all([
    prisma.order.aggregate({
      where: { email: order.email, paymentStatus: "PAID" },
      _count: { _all: true },
      _sum: { totalKobo: true, totalCents: true },
      _min: { createdAt: true },
    }),
    prisma.user.findUnique({ where: { email: order.email }, select: { id: true } }),
  ]);
  const orders = paid._count._all;
  res.json({
    order: serializeOrder(order, { internal: true }),
    customer: {
      orders,
      spend: money(paid._sum.totalKobo ?? 0, paid._sum.totalCents ?? 0),
      since: (paid._min.createdAt ?? order.createdAt).toISOString(),
      hasAccount: Boolean(account),
      tier: orders >= 3 ? "VIP" : orders === 2 ? "Returning" : "New",
    },
  });
});

/**
 * Move an order along. Accepts the enum ("SHIPPED") or the frontend label
 * ("Shipped"). `markPaid` is for pay-on-delivery and bank transfers taken offline.
 */
adminRouter.patch("/orders/:id", async (req, res) => {
  const body = z
    .object({
      status: z.string().transform((s) => STATUS_BY_LABEL[s] ?? (s in ORDER_STATUS_LABEL ? (s as OrderStatus) : undefined)).optional(),
      note: z.string().trim().max(2000).nullable().optional(),
      markPaid: z.literal(true).optional(),
      notifyCustomer: z.boolean().default(true),
    })
    .parse(req.body);
  if (body.status === undefined && "status" in (req.body ?? {})) throw badRequest("Unknown order status.", "STATUS");

  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) throw notFound();

  if (body.markPaid && order.paymentStatus !== "PAID") {
    await markOrderPaid(order.reference, {
      amountMinor: order.currency === "NGN" ? order.totalKobo : order.totalCents,
      currency: order.currency,
    });
  }

  if (body.status && body.status !== order.status) {
    await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data: { status: body.status, ...(body.status === "REFUNDED" && { paymentStatus: "REFUNDED" }) },
      }),
      prisma.orderEvent.create({ data: { orderId: order.id, label: ORDER_STATUS_LABEL[body.status] } }),
    ]);
    if (body.notifyCustomer && ["SHIPPED", "DELIVERED", "REFUNDED", "CANCELLED"].includes(body.status)) {
      sendMailInBackground(emails.orderStatusUpdate(order.email, order.name, order.reference, ORDER_STATUS_LABEL[body.status]));
    }
  }

  if (body.note !== undefined) {
    await prisma.order.update({ where: { id: order.id }, data: { note: body.note } });
  }

  const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
  res.json({ order: serializeOrder(updated, { internal: true }) });
});

/* ------------------------------------------------------------ Customers */

/**
 * One row per email that has ever ordered — guests included — joined to an
 * account where there is one. Spend counts paid orders only.
 */
adminRouter.get("/customers", async (_req, res) => {
  const [groups, accounts, subs] = await Promise.all([
    prisma.order.groupBy({
      by: ["email"],
      where: { paymentStatus: "PAID" },
      _count: { _all: true },
      _sum: { totalKobo: true, totalCents: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
    prisma.user.findMany({ select: { id: true, email: true, name: true, phone: true, createdAt: true, googleId: true } }),
    prisma.alertSubscription.findMany({ where: { enabled: true }, select: { email: true } }),
  ]);

  const latest = await prisma.order.findMany({
    where: { email: { in: groups.map((g) => g.email) } },
    orderBy: { createdAt: "desc" },
    distinct: ["email"],
    select: { email: true, name: true, phone: true, address: true },
  });
  const latestByEmail = new Map(latest.map((o) => [o.email, o]));
  const accountByEmail = new Map(accounts.map((a) => [a.email, a]));
  const subscribed = new Set(subs.map((s) => s.email));

  const customers = groups
    .map((g) => {
      const account = accountByEmail.get(g.email);
      const last = latestByEmail.get(g.email);
      const address = last?.address as { city?: string; country?: string } | undefined;
      const orders = g._count._all;
      return {
        id: account?.id ?? null,
        email: g.email,
        name: account?.name ?? last?.name ?? g.email,
        phone: account?.phone ?? last?.phone ?? "",
        city: address?.city ?? "",
        country: address?.country ?? "",
        joinedAt: (account?.createdAt ?? g._min.createdAt)!.toISOString(),
        lastOrderAt: g._max.createdAt?.toISOString() ?? null,
        hasAccount: Boolean(account),
        alertsOn: subscribed.has(g.email),
        orders,
        spend: money(g._sum.totalKobo ?? 0, g._sum.totalCents ?? 0),
        tier: orders >= 3 ? "VIP" : orders === 2 ? "Returning" : "New",
      };
    })
    .sort((a, b) => b.spend.ngn - a.spend.ngn);

  res.json({ customers });
});

/* ------------------------------------------------------------ Inbox */

adminRouter.get("/messages", async (_req, res) => {
  const messages = await prisma.contactMessage.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ messages });
});
