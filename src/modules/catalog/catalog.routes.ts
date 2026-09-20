import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.ts";
import { COLLECTIONS, MATERIALS, PAYMENT_METHODS, SHIPPING_METHODS } from "../../lib/catalog.ts";
import { notFound } from "../../lib/http-error.ts";
import { paystackCurrencies } from "../payments/paystack.ts";
import { prisma } from "../../lib/prisma.ts";
import { serializeCategory, serializeProduct } from "../../lib/serialize.ts";

export const catalogRouter = Router();

/** Everything the storefront needs to render filters and checkout options. */
catalogRouter.get("/meta", async (_req, res) => {
  const categories = await prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
  res.json({
    categories: categories.map(serializeCategory),
    collections: COLLECTIONS,
    materials: MATERIALS,
    shippingMethods: SHIPPING_METHODS,
    // Only what can actually be used right now, per currency.
    paymentMethods: PAYMENT_METHODS.map(({ id, label, hint, currencies }) => ({
      id,
      label,
      hint,
      currencies: id === "paystack" ? currencies.filter((c) => paystackCurrencies().includes(c)) : currencies,
    })).filter((m) => m.currencies.length > 0),
  });
});

catalogRouter.get("/categories", async (_req, res) => {
  const categories = await prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
  res.json({ categories: categories.map(serializeCategory) });
});

const listQuery = z.object({
  category: z.string().optional(),
  collection: z.string().optional(),
  material: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  ids: z.string().optional(),
  sort: z.enum(["featured", "newest", "price-asc", "price-desc", "bestselling"]).default("featured"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(48),
});

catalogRouter.get("/products", async (req, res) => {
  const q = listQuery.parse(req.query);

  const where: Prisma.ProductWhereInput = {
    published: true,
    ...(q.category && { categorySlug: q.category }),
    ...(q.collection && { collection: q.collection }),
    ...(q.material && { material: q.material }),
    ...(q.ids && { id: { in: q.ids.split(",").slice(0, 100) } }),
    ...(q.q && {
      OR: [
        { name: { contains: q.q, mode: "insensitive" } },
        { tagline: { contains: q.q, mode: "insensitive" } },
        { material: { contains: q.q, mode: "insensitive" } },
        { collection: { contains: q.q, mode: "insensitive" } },
      ],
    }),
  };

  const orderBy: Prisma.ProductOrderByWithRelationInput[] = {
    featured: [{ unitsSold: "desc" as const }, { createdAt: "desc" as const }],
    newest: [{ createdAt: "desc" as const }],
    "price-asc": [{ priceKobo: "asc" as const }],
    "price-desc": [{ priceKobo: "desc" as const }],
    bestselling: [{ unitsSold: "desc" as const }],
  }[q.sort];

  const [total, products] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);

  res.json({ products: products.map(serializeProduct), total, page: q.page, pageSize: q.pageSize });
});

catalogRouter.get("/products/:slug", async (req, res) => {
  const product = await prisma.product.findFirst({ where: { slug: req.params.slug, published: true } });
  if (!product) throw notFound("We couldn't find that piece.");

  // Same collection first, then same category — mirrors relatedProducts() in the frontend.
  const [sameCollection, sameCategory] = await Promise.all([
    prisma.product.findMany({
      where: { published: true, collection: product.collection, id: { not: product.id } },
      orderBy: { unitsSold: "desc" },
      take: 4,
    }),
    prisma.product.findMany({
      where: { published: true, categorySlug: product.categorySlug, id: { not: product.id }, collection: { not: product.collection } },
      orderBy: { unitsSold: "desc" },
      take: 4,
    }),
  ]);

  res.json({
    product: serializeProduct(product),
    related: [...sameCollection, ...sameCategory].slice(0, 4).map(serializeProduct),
  });
});
