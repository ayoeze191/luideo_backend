import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { Router } from "express";
import { env } from "../../config/env.ts";
import { badRequest, HttpError } from "../../lib/http-error.ts";
import { randomToken } from "../../lib/tokens.ts";

/* ------------------------------------------------------------------ *
 * Product photo uploads. The file is sent as the raw request body
 * (Content-Type: image/jpeg etc.) — no multipart parser needed.
 *
 * With CLOUDINARY_URL set, files go to Cloudinary (recommended in
 * production: hosts like Render and Railway wipe local disk on deploy).
 * Otherwise they're written to ./uploads and served from /uploads.
 *
 * Either way the URL must be public for Instagram/Facebook to fetch it.
 * ------------------------------------------------------------------ */

export const UPLOAD_DIR = path.resolve("uploads");

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export const uploadsRouter = Router();

uploadsRouter.post("/", express.raw({ type: Object.keys(TYPES), limit: "10mb" }), async (req, res) => {
  const ext = TYPES[req.get("content-type")?.split(";")[0] ?? ""];
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw badRequest("Upload a JPEG, PNG or WebP image under 10MB.", "UPLOAD_TYPE");
  }
  const url = env.CLOUDINARY_URL ? await toCloudinary(req.body, ext) : await toDisk(req.body, ext);
  res.status(201).json({ url });
});

async function toDisk(file: Buffer, ext: string) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now()}-${randomToken(9)}.${ext}`;
  await writeFile(path.join(UPLOAD_DIR, name), file);
  return `${env.API_URL}/uploads/${name}`;
}

async function toCloudinary(file: Buffer, ext: string) {
  // cloudinary://API_KEY:API_SECRET@CLOUD_NAME
  const u = new URL(env.CLOUDINARY_URL!);
  const [apiKey, apiSecret, cloud] = [decodeURIComponent(u.username), decodeURIComponent(u.password), u.hostname];
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const folder = "luideo/products";
  const signature = createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest("hex");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file)]), `upload.${ext}`);
  form.append("api_key", apiKey);
  form.append("timestamp", timestamp);
  form.append("folder", folder);
  form.append("signature", signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: "POST", body: form });
  const json = (await res.json()) as { secure_url?: string; error?: { message: string } };
  if (!res.ok || !json.secure_url) throw new HttpError(502, `Image upload failed: ${json.error?.message ?? res.statusText}`, "UPLOAD_FAILED");
  return json.secure_url;
}

/**
 * Instagram only accepts JPEG. Cloudinary can convert on the fly, so ask it
 * for a .jpg; anything else has to already be a JPEG.
 */
export function instagramImageUrl(url: string) {
  if (url.includes("res.cloudinary.com") && url.includes("/image/upload/")) {
    return url.replace("/image/upload/", "/image/upload/f_jpg,q_auto/");
  }
  return url;
}
