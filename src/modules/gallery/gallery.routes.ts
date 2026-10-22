import { Router } from "express";
import { z } from "zod";
import { notFound } from "../../lib/http-error.ts";
import { cleanupPhotosInBackground } from "../../lib/photo-cleanup.ts";
import { prisma } from "../../lib/prisma.ts";

/* ------------------------------------------------------------------ *
 * The "worn by you" wall. Public read for the shop; the admin adds,
 * captions, links, reorders and removes photos (the "gallery" area).
 * ------------------------------------------------------------------ */

const include = { product: { select: { id: true, slug: true, name: true, published: true } } } as const;

type Row = Awaited<ReturnType<typeof prisma.galleryPhoto.findMany<{ include: typeof include }>>>[number];

function serialize(p: Row, { admin = false } = {}) {
  // An unpublished piece isn't linked from the shop.
  const product = p.product && (admin || p.product.published) ? p.product : null;
  return {
    id: p.id,
    url: p.url,
    caption: p.caption,
    product: product ? { id: product.id, slug: product.slug, name: product.name } : null,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt.toISOString(),
  };
}

const ordered = [{ sortOrder: "asc" as const }, { createdAt: "desc" as const }];

/** Mounted at /api/gallery. */
export const galleryRouter = Router();

galleryRouter.get("/", async (_req, res) => {
  const photos = await prisma.galleryPhoto.findMany({ include, orderBy: ordered });
  res.json({ photos: photos.map((p) => serialize(p)) });
});

/** Mounted at /api/admin/gallery, behind the "gallery" area. */
export const adminGalleryRouter = Router();

adminGalleryRouter.get("/", async (_req, res) => {
  const photos = await prisma.galleryPhoto.findMany({ include, orderBy: ordered });
  res.json({ photos: photos.map((p) => serialize(p, { admin: true })) });
});

const photoInput = z.object({
  url: z.string().trim().min(1).max(500),
  caption: z.string().trim().max(120).default(""),
  productId: z.string().trim().min(1).nullable().optional(),
});

/** New photos go to the front of the wall. */
adminGalleryRouter.post("/", async (req, res) => {
  const body = z.object({ photos: z.array(photoInput).min(1).max(20) }).parse(req.body);
  const first = await prisma.galleryPhoto.aggregate({ _min: { sortOrder: true } });
  const top = (first._min.sortOrder ?? 0) - body.photos.length;
  await prisma.galleryPhoto.createMany({
    data: body.photos.map((p, i) => ({ url: p.url, caption: p.caption, productId: p.productId ?? null, sortOrder: top + i })),
  });
  const photos = await prisma.galleryPhoto.findMany({ include, orderBy: ordered });
  res.status(201).json({ photos: photos.map((p) => serialize(p, { admin: true })) });
});

adminGalleryRouter.patch("/:id", async (req, res) => {
  const body = photoInput.omit({ url: true }).partial().parse(req.body);
  const found = await prisma.galleryPhoto.findUnique({ where: { id: req.params.id } });
  if (!found) throw notFound("That photo isn't in the gallery any more.");
  const photo = await prisma.galleryPhoto.update({
    where: { id: req.params.id },
    data: {
      ...(body.caption !== undefined && { caption: body.caption }),
      ...(body.productId !== undefined && { productId: body.productId }),
    },
    include,
  });
  res.json({ photo: serialize(photo, { admin: true }) });
});

/** The whole wall in its new order, first to last. */
adminGalleryRouter.post("/reorder", async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string().min(1)).max(500) }).parse(req.body);
  await prisma.$transaction(ids.map((id, i) => prisma.galleryPhoto.updateMany({ where: { id }, data: { sortOrder: i } })));
  res.status(204).end();
});

adminGalleryRouter.delete("/:id", async (req, res) => {
  const photo = await prisma.galleryPhoto.findUnique({ where: { id: req.params.id } });
  await prisma.galleryPhoto.deleteMany({ where: { id: req.params.id } });
  if (photo) cleanupPhotosInBackground([photo.url]);
  res.status(204).end();
});
