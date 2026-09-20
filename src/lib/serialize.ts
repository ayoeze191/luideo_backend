import type { Category, Order, OrderEvent, OrderItem, Product, User } from "../generated/prisma/client.ts";
import { ORDER_STATUS_LABEL, PAYMENT_METHODS, PAYMENT_STATUS_LABEL } from "./catalog.ts";
import { money, optionalMoney } from "./money.ts";

/* Shapes returned here match frontend/src/lib/types.ts, so the storefront can
 * swap its mock data for API calls without touching its components. */

export type Variant = { id: string; label: string; swatch?: string; inStock: boolean };

export function serializeProduct(p: Product) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    category: p.categorySlug,
    collection: p.collection,
    material: p.material,
    price: money(p.priceKobo, p.priceCents),
    compareAt: optionalMoney(p.compareAtKobo, p.compareAtCents),
    photo: p.photo ?? undefined,
    finishes: p.finishes as Variant[],
    sizes: (p.sizes as Variant[] | null) ?? undefined,
    sizeLabel: p.sizeLabel ?? undefined,
    description: p.description,
    details: p.details,
    care: p.care,
    badge: p.stock === 1 ? "Last one" : (p.badge ?? undefined),
    rating: p.rating,
    reviews: p.reviews,
    stock: p.stock,
    sku: p.sku,
    madeToOrderDays: p.madeToOrderDays,
    createdAt: p.createdAt.toISOString(),
    unitsSold: p.unitsSold,
    published: p.published,
  };
}

export function serializeCategory(c: Category) {
  return { slug: c.slug, name: c.name, blurb: c.blurb, photo: c.photo ?? undefined };
}

export function serializeUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    avatarUrl: u.avatarUrl,
    role: u.role,
    emailVerified: u.emailVerifiedAt != null,
    hasPassword: u.passwordHash != null,
    hasGoogle: u.googleId != null,
    createdAt: u.createdAt.toISOString(),
  };
}

type FullOrder = Order & { items: OrderItem[]; events: OrderEvent[] };

/** `internal` includes the studio's private note — admin responses only. */
export function serializeOrder(o: FullOrder, { internal = false } = {}) {
  const address = o.address as { line1: string; city: string; state: string; country: string; postcode?: string };
  return {
    id: o.id,
    reference: o.reference,
    customerId: o.userId,
    email: o.email,
    name: o.name,
    phone: o.phone,
    placedAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    status: ORDER_STATUS_LABEL[o.status],
    payment: PAYMENT_STATUS_LABEL[o.paymentStatus],
    paymentMethod: PAYMENT_METHODS.find((m) => m.provider === o.paymentProvider)?.label ?? o.paymentProvider,
    channel: o.channel,
    currency: o.currency,
    items: o.items.map((i) => ({
      productId: i.productId,
      slug: i.slug,
      name: i.name,
      finish: i.finishLabel,
      size: i.sizeLabel ?? undefined,
      quantity: i.quantity,
      unitPrice: money(i.unitKobo, i.unitCents),
      photo: i.photo ?? undefined,
    })),
    subtotal: money(o.subtotalKobo, o.subtotalCents),
    shippingCost: money(o.shippingKobo, o.shippingCents),
    discount: o.discountKobo || o.discountCents ? money(o.discountKobo, o.discountCents) : undefined,
    total: money(o.totalKobo, o.totalCents),
    shippingMethod: o.shippingMethod,
    address,
    etaDays: o.etaDays,
    timeline: o.events
      .slice()
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((e) => ({ label: e.label, at: e.at.toISOString(), done: true })),
    note: internal ? (o.note ?? undefined) : undefined,
  };
}

export function formatPrice(minor: number, currency: "NGN" | "USD") {
  const major = minor / 100;
  const symbol = currency === "NGN" ? "₦" : "$";
  const digits = currency === "NGN" || major % 1 === 0 ? 0 : 2;
  return `${symbol}${major.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
