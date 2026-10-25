import { createHash } from "node:crypto";
import { env } from "../config/env.ts";
import { prisma } from "./prisma.ts";
import type { Variant } from "./variants.ts";

/* ------------------------------------------------------------------ *
 * Removes product photos from Cloudinary once nothing uses them.
 *
 * "Uses" is wider than the product: a past order keeps its item's photo
 * (receipts, the admin order page, the customer's account), the gallery
 * and categories can reuse one, and a social post that hasn't gone out
 * yet still needs its picture. A photo is deleted only when none of
 * those point at it — so sold pieces keep their pictures in order
 * history, and nothing visible ever breaks.
 *
 * Only images this site uploaded (the luideo/ folder) are ever touched.
 * ------------------------------------------------------------------ */

const FOLDER = "luideo/";
/** Uploads younger than this are left alone: they may be in a form or a saved draft. */
const SWEEP_MIN_AGE_DAYS = 7;
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

function config() {
  if (!env.CLOUDINARY_URL) return null;
  const u = new URL(env.CLOUDINARY_URL);
  return { apiKey: decodeURIComponent(u.username), apiSecret: decodeURIComponent(u.password), cloud: u.hostname };
}

/** `…/image/upload/v123/luideo/products/abc.jpg` → `luideo/products/abc`, for our own cloud only. */
export function publicIdOf(url: string | null | undefined): string | null {
  const cfg = config();
  if (!url || !cfg) return null;
  const m = url.match(/^https:\/\/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(luideo\/[^?#]+?)\.[a-z0-9]+(?:[?#].*)?$/i);
  const [, cloud, id] = m ?? [];
  if (!cloud || !id || cloud !== cfg.cloud || !id.startsWith(FOLDER)) return null;
  return id;
}

/** Every photo something on the site still points at, as Cloudinary ids. */
async function inUse(): Promise<Set<string>> {
  const [products, items, gallery, categories, posts, receipts] = await Promise.all([
    prisma.product.findMany({ select: { photo: true, gallery: true, finishes: true } }),
    prisma.orderItem.findMany({ where: { photo: { not: null } }, select: { photo: true }, distinct: ["photo"] }),
    prisma.galleryPhoto.findMany({ select: { url: true } }),
    prisma.category.findMany({ where: { photo: { not: null } }, select: { photo: true } }),
    prisma.socialPost.findMany({ where: { status: { not: "POSTED" } }, select: { imageUrl: true } }),
    // Payment receipts share the upload folder and must be kept as proof of payment.
    prisma.order.findMany({ where: { paymentReceiptUrl: { not: null } }, select: { paymentReceiptUrl: true } }),
  ]);

  const urls: (string | null | undefined)[] = [
    ...products.flatMap((p) => [p.photo, ...p.gallery, ...((p.finishes ?? []) as Variant[]).map((f) => f.photo)]),
    ...items.map((i) => i.photo),
    ...gallery.map((g) => g.url),
    ...categories.map((c) => c.photo),
    ...posts.map((s) => s.imageUrl),
    ...receipts.map((o) => o.paymentReceiptUrl),
  ];
  return new Set(urls.map(publicIdOf).filter((id): id is string => !!id));
}

async function destroy(publicId: string) {
  const cfg = config()!;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHash("sha1").update(`public_id=${publicId}&timestamp=${timestamp}${cfg.apiSecret}`).digest("hex");
  const form = new FormData();
  form.append("public_id", publicId);
  form.append("timestamp", timestamp);
  form.append("api_key", cfg.apiKey);
  form.append("signature", signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloud}/image/destroy`, { method: "POST", body: form });
  const json = (await res.json().catch(() => ({}))) as { result?: string };
  if (!res.ok || (json.result !== "ok" && json.result !== "not found")) {
    throw new Error(`Cloudinary destroy ${publicId}: ${res.status} ${json.result ?? ""}`);
  }
}

/** Deletes whichever of these photos nothing uses any more. Call after the change is saved. */
export async function cleanupPhotos(urls: (string | null | undefined)[]) {
  if (!config()) return;
  const candidates = [...new Set(urls.map(publicIdOf).filter((id): id is string => !!id))];
  if (!candidates.length) return;
  const used = await inUse();
  for (const id of candidates) {
    if (used.has(id)) continue;
    await destroy(id).catch((err) => console.warn("Photo cleanup:", (err as Error).message));
  }
}

export function cleanupPhotosInBackground(urls: (string | null | undefined)[]) {
  void cleanupPhotos(urls).catch((err) => console.warn("Photo cleanup failed:", (err as Error).message));
}

/** Every photo a product holds: main, extras and each version's. */
export function photosOf(p: { photo: string | null; gallery: string[]; finishes: unknown }) {
  return [p.photo, ...p.gallery, ...((p.finishes ?? []) as Variant[]).map((f) => f.photo)];
}

/**
 * The daily tidy-up: uploads that never got saved anywhere (picked, then
 * removed or replaced in a form) and anything the immediate clean-up missed.
 * Only files older than a week, so nothing in a form or draft is touched.
 */
async function sweep() {
  const cfg = config();
  if (!cfg) return;
  const auth = `Basic ${Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64")}`;
  const cutoff = Date.now() - SWEEP_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  const used = await inUse();
  let cursor: string | undefined;
  let removed = 0;
  do {
    const q = new URLSearchParams({ prefix: FOLDER, max_results: "500", ...(cursor && { next_cursor: cursor }) });
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloud}/resources/image/upload?${q}`, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`Cloudinary list: ${res.status}`);
    const page = (await res.json()) as { resources: { public_id: string; created_at: string }[]; next_cursor?: string };
    for (const r of page.resources) {
      if (!r.public_id.startsWith(FOLDER) || used.has(r.public_id)) continue;
      if (new Date(r.created_at).getTime() > cutoff) continue;
      await destroy(r.public_id).then(() => removed++).catch((err) => console.warn("Photo sweep:", (err as Error).message));
    }
    cursor = page.next_cursor;
  } while (cursor);
  if (removed) console.log(`Photo sweep: removed ${removed} unused photo(s) from Cloudinary.`);
}

export function startPhotoSweep() {
  if (!config()) return;
  const run = () => void sweep().catch((err) => console.warn("Photo sweep failed:", (err as Error).message));
  // A little after start-up, then once a day.
  setTimeout(run, 60_000).unref();
  setInterval(run, SWEEP_EVERY_MS).unref();
}
