import { prisma } from "./prisma.ts";

/* ------------------------------------------------------------------ *
 * Sales figures and the "Bestseller" label come only from real, paid
 * orders — never typed in. Cancelled and refunded orders don't count.
 * ------------------------------------------------------------------ */

/** How many pieces can be bestsellers at once, and the fewest sales that earns it. */
const BESTSELLER_COUNT = 3;
const BESTSELLER_MIN_SOLD = 2;

/**
 * Recounts every product's units sold from paid orders and re-marks the
 * bestsellers. Cheap at a studio's scale; runs at startup and whenever a
 * payment clears or an order is cancelled or refunded.
 */
export async function syncSales() {
  const rows = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: { productId: { not: null }, order: { paymentStatus: "PAID", status: { notIn: ["CANCELLED", "REFUNDED"] } } },
    _sum: { quantity: true },
  });
  const sold = new Map(rows.map((r) => [r.productId!, r._sum.quantity ?? 0]));
  const bestsellers = new Set(
    [...sold]
      .filter(([, n]) => n >= BESTSELLER_MIN_SOLD)
      .sort((a, b) => b[1] - a[1])
      .slice(0, BESTSELLER_COUNT)
      .map(([id]) => id),
  );

  const products = await prisma.product.findMany({ select: { id: true, unitsSold: true, badge: true } });
  for (const p of products) {
    const unitsSold = sold.get(p.id) ?? 0;
    const badge = bestsellers.has(p.id) ? "Bestseller" : null;
    if (p.unitsSold !== unitsSold || p.badge !== badge) {
      await prisma.product.update({ where: { id: p.id }, data: { unitsSold, badge } });
    }
  }
}

/** After the response: a slow recount should never hold up a checkout or an admin action. */
export function syncSalesInBackground() {
  setImmediate(() => syncSales().catch((err) => console.error("Sales sync failed:", err)));
}
