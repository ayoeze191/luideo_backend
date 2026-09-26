/* Seeds categories and products from the storefront's catalogue snapshot
 * (seed-data.json), and creates the first admin from ADMIN_EMAIL/ADMIN_PASSWORD.
 * Safe to re-run: everything is upserted. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

type Money = { ngn: number; usd: number };
type SeedData = {
  categories: { slug: string; name: string; blurb: string; photo?: string }[];
  products: {
    id: string; slug: string; name: string; tagline: string; category: string; collection: string; material: string;
    price: Money; compareAt?: Money; photo?: string; finishes: object[]; sizes?: object[]; sizeLabel?: string;
    description: string; details: string[]; care: string[]; badge?: string; rating: number; reviews: number;
    stock: number; sku: string; madeToOrderDays: number; createdAt: string; unitsSold: number;
  }[];
};

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const data = JSON.parse(readFileSync(new URL("./seed-data.json", import.meta.url), "utf8")) as SeedData;
const minor = (n: number) => Math.round(n * 100);

async function main() {
  for (const [i, c] of data.categories.entries()) {
    const row = { name: c.name, blurb: c.blurb, photo: c.photo ?? null, sortOrder: i };
    await prisma.category.upsert({ where: { slug: c.slug }, create: { slug: c.slug, ...row }, update: row });
  }

  for (const p of data.products) {
    const row = {
      slug: p.slug,
      name: p.name,
      tagline: p.tagline,
      categorySlug: p.category,
      collection: p.collection,
      material: p.material,
      priceKobo: minor(p.price.ngn),
      priceCents: minor(p.price.usd),
      compareAtKobo: p.compareAt ? minor(p.compareAt.ngn) : null,
      compareAtCents: p.compareAt ? minor(p.compareAt.usd) : null,
      photo: p.photo ?? null,
      finishes: p.finishes,
      sizes: p.sizes,
      sizeLabel: p.sizeLabel ?? null,
      description: p.description,
      details: p.details,
      care: p.care,
      // "Last one" is derived from stock at read time, not stored.
      badge: p.badge === "Last one" ? null : (p.badge ?? null),
      rating: p.rating,
      reviews: p.reviews,
      stock: p.stock,
      sku: p.sku,
      madeToOrderDays: p.madeToOrderDays,
      unitsSold: p.unitsSold,
      createdAt: new Date(p.createdAt),
      // Seeded pieces are the existing catalogue — don't email anyone about them.
      alertsSentAt: new Date(),
    };
    // Keep the frontend's ids (prd-001…) so carts saved in localStorage still resolve.
    await prisma.product.upsert({ where: { id: p.id }, create: { id: p.id, ...row }, update: row });
  }
  console.log(`Seeded ${data.categories.length} categories and ${data.products.length} products.`);

  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    if (ADMIN_PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
    const email = ADMIN_EMAIL.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    // Re-running the seed also resets the admin's password to ADMIN_PASSWORD.
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: ADMIN_NAME || "Lui'Deo Studio",
        role: "ADMIN",
        emailVerifiedAt: new Date(),
        passwordHash,
      },
      update: { role: "ADMIN", emailVerifiedAt: new Date(), passwordHash },
    });
    console.log(`Admin ready: ${email}`);
  } else {
    console.log("No ADMIN_EMAIL/ADMIN_PASSWORD set — skipped creating an admin.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
