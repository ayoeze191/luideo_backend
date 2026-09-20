import { money } from "../../lib/money.ts";
import { prisma } from "../../lib/prisma.ts";
import { serializeProduct } from "../../lib/serialize.ts";

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type MonthRow = { month: Date; kobo: bigint | null; cents: bigint | null; orders: bigint };

const pctChange = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 1000) / 10 : 0);

/**
 * Real numbers for the admin dashboard, shaped like frontend/src/lib/analytics.ts
 * (MONTHLY, KPIS, CATEGORY_SALES, TOP_PRODUCTS, LOW_STOCK, STORE_TOTALS).
 * Revenue only counts paid orders.
 */
export async function dashboardStats() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth() - 11, 1));

  const rows = await prisma.$queryRaw<MonthRow[]>`
    SELECT date_trunc('month', "paidAt") AS month,
           SUM("totalKobo") AS kobo, SUM("totalCents") AS cents, COUNT(*) AS orders
    FROM "Order"
    WHERE "paymentStatus" = 'PAID' AND "paidAt" >= ${start}
    GROUP BY 1`;
  const byMonth = new Map(rows.map((r) => [r.month.toISOString().slice(0, 7), r]));

  const monthly = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
    const prior = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), 1));
    const cur = byMonth.get(d.toISOString().slice(0, 7));
    const old = byMonth.get(prior.toISOString().slice(0, 7));
    return {
      month: d.toISOString().slice(0, 7),
      label: MONTH_LABEL[d.getUTCMonth()]!,
      revenue: money(Number(cur?.kobo ?? 0), Number(cur?.cents ?? 0)),
      priorRevenue: money(Number(old?.kobo ?? 0), Number(old?.cents ?? 0)),
      orders: Number(cur?.orders ?? 0),
    };
  });

  const last = monthly[11]!;
  const prev = monthly[10]!;
  const aov = (m: (typeof monthly)[number]) => (m.orders ? m.revenue.ngn / m.orders : 0);

  const [paidEmails, returningEmails] = await Promise.all([
    prisma.order.groupBy({ by: ["email"], where: { paymentStatus: "PAID" } }),
    prisma.order.groupBy({ by: ["email"], where: { paymentStatus: "PAID" }, having: { email: { _count: { gt: 1 } } } }),
  ]);
  const returningPct = paidEmails.length ? Math.round((returningEmails.length / paidEmails.length) * 1000) / 10 : 0;

  const kpis = [
    { id: "revenue", label: "Revenue this month", value: last.revenue, kind: "money", deltaPct: pctChange(last.revenue.ngn, prev.revenue.ngn), deltaLabel: `vs. ${prev.label}`, upIsGood: true, spark: monthly.map((m) => m.revenue.ngn) },
    { id: "orders", label: "Orders this month", value: last.orders, kind: "count", deltaPct: pctChange(last.orders, prev.orders), deltaLabel: `vs. ${prev.label}`, upIsGood: true, spark: monthly.map((m) => m.orders) },
    { id: "aov", label: "Average order value", value: last.orders ? { ngn: Math.round(aov(last)), usd: Math.round(last.revenue.usd / last.orders) } : { ngn: 0, usd: 0 }, kind: "money", deltaPct: pctChange(aov(last), aov(prev)), deltaLabel: `vs. ${prev.label}`, upIsGood: true, spark: monthly.map((m) => Math.round(aov(m))) },
    { id: "returning", label: "Returning customers", value: returningPct, kind: "percent", deltaPct: 0, deltaLabel: "all time", upIsGood: true, spark: [] as number[] },
  ];

  const [categories, soldByCategory, products, lifetime, customers] = await Promise.all([
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.$queryRaw<{ category: string; units: bigint; kobo: bigint; cents: bigint }[]>`
      SELECT i.category, SUM(i.quantity) AS units,
             SUM(i.quantity * i."unitKobo") AS kobo, SUM(i.quantity * i."unitCents") AS cents
      FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
      WHERE o."paymentStatus" = 'PAID'
      GROUP BY i.category`,
    prisma.product.findMany({ where: { published: true } }),
    prisma.order.aggregate({ where: { paymentStatus: "PAID" }, _count: { _all: true }, _sum: { totalKobo: true, totalCents: true } }),
    prisma.order.groupBy({ by: ["email"] }),
  ]);

  const soldMap = new Map(soldByCategory.map((r) => [r.category, r]));
  const categorySales = categories
    .map((c) => {
      const r = soldMap.get(c.slug);
      return { slug: c.slug, name: c.name, units: Number(r?.units ?? 0), revenue: money(Number(r?.kobo ?? 0), Number(r?.cents ?? 0)) };
    })
    .sort((a, b) => b.revenue.ngn - a.revenue.ngn);

  const topProducts = [...products]
    .sort((a, b) => b.unitsSold * b.priceKobo - a.unitsSold * a.priceKobo)
    .slice(0, 6)
    .map((p) => ({ id: p.id, slug: p.slug, name: p.name, photo: p.photo ?? undefined, units: p.unitsSold, revenue: money(p.unitsSold * p.priceKobo, p.unitsSold * p.priceCents), stock: p.stock }));

  const lowStock = products.filter((p) => p.stock <= 8).sort((a, b) => a.stock - b.stock).slice(0, 5).map(serializeProduct);

  const channelRows = await prisma.order.groupBy({ by: ["channel"], where: { paymentStatus: "PAID" }, _sum: { totalKobo: true, totalCents: true } });
  const channelTotal = channelRows.reduce((n, r) => n + (r._sum.totalKobo ?? 0), 0);
  const channelSplit = channelRows
    .map((r) => ({ channel: r.channel, share: channelTotal ? (r._sum.totalKobo ?? 0) / channelTotal : 0, revenue: money(r._sum.totalKobo ?? 0, r._sum.totalCents ?? 0) }))
    .sort((a, b) => b.share - a.share);

  return {
    monthly,
    kpis,
    categorySales,
    channelSplit,
    topProducts,
    lowStock,
    totals: {
      lifetimeRevenue: money(lifetime._sum.totalKobo ?? 0, lifetime._sum.totalCents ?? 0),
      lifetimeOrders: lifetime._count._all,
      customers: customers.length,
      piecesMade: products.reduce((n, p) => n + p.unitsSold, 0),
    },
  };
}
