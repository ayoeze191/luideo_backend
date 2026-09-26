import * as emails from "../../emails/templates.ts";
import type { User } from "../../generated/prisma/client.ts";
import { forbidden } from "../../lib/http-error.ts";
import { sendMail } from "../../lib/mailer.ts";
import { prisma } from "../../lib/prisma.ts";
import { formatPrice } from "../../lib/serialize.ts";
import { randomToken } from "../../lib/tokens.ts";

/* ------------------------------------------------------------------ *
 * "Tell me when something like what I bought comes in."
 *
 * Anyone with an email can subscribe — guests tick a box at checkout,
 * signed-in customers manage it from their account. When a product is
 * published we match it against:
 *   1. what each subscriber has PAID for (same category or collection), and
 *   2. categories / collections they explicitly follow.
 * Each match becomes a ProductAlert (the in-app notification) and an email.
 * ------------------------------------------------------------------ */

export type AlertPreferences = {
  enabled: boolean;
  similarToPurchases: boolean;
  categories: string[];
  collections: string[];
};

/** Guest opt-in at checkout, keyed by the email they typed. */
export async function subscribeGuest(email: string) {
  await prisma.alertSubscription.upsert({
    where: { email },
    create: { email, unsubscribeToken: randomToken() },
    update: { enabled: true, similarToPurchases: true },
  });
}

/** The footer's "studio letter": follow every category, so each new piece is announced. */
export async function subscribeNewsletter(email: string) {
  const categories = (await prisma.category.findMany({ select: { slug: true } })).map((c) => c.slug);
  const existing = await prisma.alertSubscription.findUnique({ where: { email } });
  if (existing) {
    await prisma.alertSubscription.update({
      where: { id: existing.id },
      data: { enabled: true, categories: [...new Set([...existing.categories, ...categories])] },
    });
  } else {
    await prisma.alertSubscription.create({ data: { email, categories, unsubscribeToken: randomToken() } });
  }
}

/** Finds the user's subscription, adopting a guest one under the same (verified) email. */
async function findForUser(user: User) {
  const mine = await prisma.alertSubscription.findUnique({ where: { userId: user.id } });
  if (mine) return mine;
  if (!user.emailVerifiedAt) return null;
  const guest = await prisma.alertSubscription.findFirst({ where: { email: user.email, userId: null } });
  return guest ? prisma.alertSubscription.update({ where: { id: guest.id }, data: { userId: user.id } }) : null;
}

export async function getPreferences(user: User): Promise<AlertPreferences> {
  const sub = await findForUser(user);
  return sub
    ? { enabled: sub.enabled, similarToPurchases: sub.similarToPurchases, categories: sub.categories, collections: sub.collections }
    : { enabled: false, similarToPurchases: true, categories: [], collections: [] };
}

export async function setPreferences(user: User, prefs: Partial<AlertPreferences>) {
  const existing = await findForUser(user);
  if (existing) {
    await prisma.alertSubscription.update({ where: { id: existing.id }, data: prefs });
  } else {
    // Alerts are emails, so we need to know the address is really theirs.
    if (!user.emailVerifiedAt) throw forbidden("Confirm your email address to turn on alerts.");
    await prisma.alertSubscription.create({
      data: { email: user.email, userId: user.id, unsubscribeToken: randomToken(), enabled: true, ...prefs },
    });
  }
  return getPreferences(user);
}

export async function unsubscribe(token: string) {
  const result = await prisma.alertSubscription.updateMany({ where: { unsubscribeToken: token }, data: { enabled: false } });
  return result.count > 0;
}

/* ------------------------------------------------------------------ Fan-out */

export async function notifyForNewProduct(productId: string) {
  // Claim the product atomically so a double publish can't double-send.
  const claimed = await prisma.product.updateMany({
    where: { id: productId, published: true, alertsSentAt: null },
    data: { alertsSentAt: new Date() },
  });
  if (claimed.count === 0) return { matched: 0 };

  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId }, include: { category: true } });
  const categoryName = product.category.name;

  // Who has paid for something in the same category or collection?
  const purchases = await prisma.orderItem.findMany({
    where: {
      order: { paymentStatus: "PAID" },
      OR: [{ category: product.categorySlug }, { collection: product.collection }],
    },
    select: { category: true, collection: true, order: { select: { email: true, userId: true } } },
  });

  const reasonByEmail = new Map<string, string>();
  const reasonByUser = new Map<string, string>();
  for (const p of purchases) {
    // A category match is the stronger signal, so it overrides a collection match.
    const isCategory = p.category === product.categorySlug;
    const reason = isCategory
      ? `Because you bought from ${categoryName}`
      : `Because you bought from the ${product.collection} collection`;
    if (isCategory || !reasonByEmail.has(p.order.email)) reasonByEmail.set(p.order.email, reason);
    if (p.order.userId && (isCategory || !reasonByUser.has(p.order.userId))) reasonByUser.set(p.order.userId, reason);
  }

  const subscriptions = await prisma.alertSubscription.findMany({
    where: {
      enabled: true,
      OR: [
        { similarToPurchases: true, email: { in: [...reasonByEmail.keys()] } },
        { similarToPurchases: true, userId: { in: [...reasonByUser.keys()] } },
        { categories: { has: product.categorySlug } },
        { collections: { has: product.collection } },
      ],
    },
  });

  const alerts = subscriptions.map((s) => {
    const purchaseReason = s.similarToPurchases
      ? ((s.userId && reasonByUser.get(s.userId)) ?? reasonByEmail.get(s.email))
      : undefined;
    const reason =
      purchaseReason ??
      (s.categories.includes(product.categorySlug) ? `New in ${categoryName}, which you follow` : `New in the ${product.collection} collection, which you follow`);
    return { subscriptionId: s.id, productId: product.id, reason };
  });

  if (alerts.length) await prisma.productAlert.createMany({ data: alerts, skipDuplicates: true });

  // Emails go out one at a time: a small list, and it keeps SMTP providers happy.
  const pending = await prisma.productAlert.findMany({
    where: { productId: product.id, emailedAt: null },
    include: { subscription: true },
  });
  for (const alert of pending) {
    try {
      await sendMail(
        emails.similarProductAlert({
          to: alert.subscription.email,
          productName: product.name,
          tagline: product.tagline,
          slug: product.slug,
          priceLabel: `${formatPrice(product.priceKobo, "NGN")} / ${formatPrice(product.priceCents, "USD")}`,
          reason: alert.reason,
          unsubscribeToken: alert.subscription.unsubscribeToken,
        }),
      );
      await prisma.productAlert.update({ where: { id: alert.id }, data: { emailedAt: new Date() } });
    } catch (err) {
      console.error(`Alert email for ${product.slug} to ${alert.subscription.email} failed:`, err);
    }
  }

  return { matched: alerts.length };
}

/** Run the fan-out after the response has gone — publishing shouldn't wait on email. */
export function notifyForNewProductInBackground(productId: string) {
  setImmediate(() => {
    notifyForNewProduct(productId)
      .then(({ matched }) => matched && console.log(`New-piece alerts: ${matched} sent for ${productId}`))
      .catch((err) => console.error(`New-piece alerts failed for ${productId}:`, err));
  });
}
