// Tries to bring back deleted photos from Cloudinary's backup.
// Works only if "Automatic backup" was on in Cloudinary when they were deleted.
//
//   railway run node scripts/restore-photos.mjs            (uses scripts/missing-photos.txt)
//   CLOUDINARY_URL=cloudinary://KEY:SECRET@CLOUD node scripts/restore-photos.mjs
//
// It only restores; it never deletes or changes anything else.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raw = process.env.CLOUDINARY_URL;
if (!raw) {
  console.error("CLOUDINARY_URL isn't set. Run it with `railway run …` from the backend service, or set it yourself.");
  process.exit(1);
}
const u = new URL(raw);
const [key, secret, cloud] = [decodeURIComponent(u.username), decodeURIComponent(u.password), u.hostname];
const auth = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;

const listFile = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "missing-photos.txt");
const ids = readFileSync(listFile, "utf8").split(/\s+/).filter(Boolean);
console.log(`Trying to restore ${ids.length} photo(s) in cloud "${cloud}"…`);

let restored = 0;
const failed = [];
// The restore endpoint takes up to 100 ids at a time.
for (let i = 0; i < ids.length; i += 100) {
  const body = new URLSearchParams();
  for (const id of ids.slice(i, i + 100)) body.append("public_ids[]", id);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/resources/image/upload/restore`, {
    method: "POST",
    headers: { Authorization: auth },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Cloudinary said ${res.status}:`, json?.error?.message ?? json);
    process.exit(1);
  }
  for (const [id, r] of Object.entries(json)) {
    if (r && r.error) failed.push(`${id} — ${r.error.message ?? r.error}`);
    else restored++;
  }
}

console.log(`Restored: ${restored}`);
if (failed.length) {
  console.log(`Couldn't restore ${failed.length}:`);
  for (const f of failed) console.log("  " + f);
  console.log("\nIf it says there's no backup, Cloudinary's backup was off; those photos need uploading again.");
}
