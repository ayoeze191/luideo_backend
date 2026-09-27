import { env } from "../../config/env.ts";
import type { SocialConnection, SocialPost, SocialTarget } from "../../generated/prisma/client.ts";
import { decrypt, encrypt } from "../../lib/crypto.ts";
import { badRequest, HttpError } from "../../lib/http-error.ts";
import { prisma } from "../../lib/prisma.ts";
import { instagramImageUrl } from "../uploads/uploads.ts";
import {
  PROVIDER_NAME,
  PlatformError,
  THREADS_MAX_TEXT,
  isConfigured,
  publishInstagram,
  publishThreads,
  refreshToken,
  whoAmI,
  type Provider,
} from "./platforms.ts";

export const PROVIDERS: Provider[] = ["instagram", "threads"];

/* ------------------------------------------------------------ Connection */

/** One entry per platform: set up on the server? connected, as whom? anything wrong? */
export async function connectionStatus() {
  const rows = await prisma.socialConnection.findMany();
  const entries = await Promise.all(
    PROVIDERS.map(async (p) => {
      const row = rows.find((r) => r.id === p);
      if (!row) return [p, { configured: isConfigured(p), account: null, problem: null }] as const;
      // A cheap live check, so a revoked login shows up here rather than at publish time.
      let problem: string | null = null;
      try {
        await whoAmI(p, decrypt(row.tokenEnc));
      } catch (err) {
        problem =
          err instanceof PlatformError && err.isAuth
            ? `${PROVIDER_NAME[p]} access has expired or was removed — connect again.`
            : `Couldn't reach ${PROVIDER_NAME[p]} just now.`;
      }
      return [p, { configured: isConfigured(p), account: { id: row.accountId, username: row.username }, problem }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<
    Provider,
    { configured: boolean; account: { id: string; username: string | null } | null; problem: string | null }
  >;
}

/** After logging in: store the (encrypted) token and whose account it is. */
export async function saveConnection(p: Provider, token: string, expiresAt: Date | null, adminId: string) {
  const { accountId, username } = await whoAmI(p, token);
  const data = { accountId, username, tokenEnc: encrypt(token), tokenExpiresAt: expiresAt, connectedById: adminId };
  await prisma.socialConnection.upsert({ where: { id: p }, create: { id: p, ...data }, update: data });
  return username;
}

export async function disconnect(p: Provider) {
  await prisma.socialConnection.deleteMany({ where: { id: p } });
}

/**
 * Long-lived tokens last 60 days and can be renewed while still valid (and at
 * least a day old). Renew anything with under three weeks left, so a quiet
 * month never logs her out.
 */
async function refreshExpiringTokens() {
  const soon = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const due = await prisma.socialConnection.findMany({ where: { tokenExpiresAt: { lte: soon }, updatedAt: { lte: dayAgo } } });
  for (const row of due) {
    try {
      const fresh = await refreshToken(row.id as Provider, decrypt(row.tokenEnc));
      await prisma.socialConnection.update({ where: { id: row.id }, data: { tokenEnc: encrypt(fresh.token), tokenExpiresAt: fresh.expiresAt } });
      console.log(`Renewed the ${row.id} login, now valid until ${fresh.expiresAt?.toISOString() ?? "?"}`);
    } catch (err) {
      console.error(`Couldn't renew the ${row.id} login:`, err instanceof Error ? err.message : err);
    }
  }
}

/* ------------------------------------------------------------ Publishing */

export const TARGET_IDS: Record<string, SocialTarget> = {
  "ig-feed": "IG_FEED",
  "ig-story": "IG_STORY",
  threads: "THREADS",
};
const TARGET_LABEL: Record<SocialTarget, string> = {
  IG_FEED: "Instagram feed",
  IG_STORY: "Instagram story",
  THREADS: "Threads",
  FB_FEED: "Facebook page",
  FB_STORY: "Facebook story",
};
const TARGET_PROVIDER: Partial<Record<SocialTarget, Provider>> = { IG_FEED: "instagram", IG_STORY: "instagram", THREADS: "threads" };
export const targetId = (t: SocialTarget) => Object.entries(TARGET_IDS).find(([, v]) => v === t)?.[0] ?? t.toLowerCase();

/**
 * Relative paths (e.g. /brand/coral-set.jpg) live on the storefront, and so do
 * bare brand-photo keys like "coral-red-set" that seeded products carry.
 */
const absolute = (url: string) => {
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith("/")) return `${env.FRONTEND_URL}${url}`;
  return `${env.FRONTEND_URL}/brand/${url}.jpg`;
};

/** Threads: the caption, trimmed to fit, with the product link on the end (Instagram captions can't carry links). */
function threadsText(caption: string, link: string | null) {
  const tail = link ? `\n\n${link}` : "";
  const room = THREADS_MAX_TEXT - tail.length;
  const body = caption.length > room ? `${caption.slice(0, room - 1).trimEnd()}…` : caption;
  return `${body}${tail}`.trim();
}

export async function createPosts(input: {
  productId?: string;
  imageUrl: string;
  caption: string;
  link?: string;
  targets: SocialTarget[];
  scheduledAt?: Date;
}) {
  const imageUrl = absolute(input.imageUrl);
  if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0)/.test(imageUrl)) {
    throw badRequest("Instagram and Threads can't download images from localhost. Use a public URL (deploy, or a tunnel like ngrok).", "IMAGE_NOT_PUBLIC");
  }

  const posts = await prisma.$transaction(
    input.targets.map((target) =>
      prisma.socialPost.create({
        data: {
          productId: input.productId,
          target,
          caption: input.caption,
          imageUrl,
          link: input.link,
          status: input.scheduledAt ? "SCHEDULED" : "PUBLISHING",
          scheduledAt: input.scheduledAt,
        },
      }),
    ),
  );

  if (input.scheduledAt) return posts;
  // Publish in sequence — Meta rate-limits bursts, and it keeps errors attributable.
  const done: SocialPost[] = [];
  for (const post of posts) done.push(await publish(post));
  return done;
}

/** Try a failed post again, now. */
export async function retry(postId: string) {
  const { count } = await prisma.socialPost.updateMany({ where: { id: postId, status: "FAILED" }, data: { status: "PUBLISHING", error: null } });
  if (!count) throw badRequest("Only failed posts can be retried.", "NOT_FAILED");
  return publish(await prisma.socialPost.findUniqueOrThrow({ where: { id: postId } }));
}

async function publish(post: SocialPost): Promise<SocialPost> {
  try {
    const provider = TARGET_PROVIDER[post.target];
    if (!provider) throw new HttpError(400, "Facebook posting has been removed.", "UNSUPPORTED");
    const conn: SocialConnection | null = await prisma.socialConnection.findUnique({ where: { id: provider } });
    if (!conn) throw new HttpError(400, `${PROVIDER_NAME[provider]} isn't connected.`, "NOT_CONNECTED");
    const token = decrypt(conn.tokenEnc);
    // Both accept JPEG; Cloudinary converts on the fly when the upload was something else.
    const imageUrl = instagramImageUrl(post.imageUrl);

    const result =
      provider === "threads"
        ? await publishThreads(conn.accountId, token, { imageUrl, text: threadsText(post.caption, post.link) })
        : await publishInstagram(conn.accountId, token, { imageUrl, caption: post.caption, story: post.target === "IG_STORY" });

    return prisma.socialPost.update({
      where: { id: post.id },
      data: { status: "POSTED", postedAt: new Date(), externalId: result.externalId, permalink: result.permalink, error: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Social post ${post.id} (${post.target}) failed:`, message);
    return prisma.socialPost.update({ where: { id: post.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
  }
}

/** What the admin composer shows after publishing. */
export function outcome(post: SocialPost) {
  const label = TARGET_LABEL[post.target];
  return {
    id: post.id,
    target: targetId(post.target),
    status: post.status === "POSTED" ? "posted" : post.status === "FAILED" ? "failed" : "scheduled",
    message:
      post.status === "POSTED"
        ? `Posted to ${label}`
        : post.status === "FAILED"
          ? `${label}: ${post.error ?? "failed"}`
          : `Scheduled to ${label} for ${post.scheduledAt?.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} (Lagos time)`,
    permalink: post.permalink ?? undefined,
  };
}

/* ------------------------------------------------------------ Scheduler */

/**
 * Neither API schedules posts, so we run our own: every minute, publish what's
 * due. Once an hour, renew any login that's getting close to expiring.
 */
export function startSocialScheduler() {
  let lastRefresh = 0;
  const tick = async () => {
    if (Date.now() - lastRefresh > 60 * 60 * 1000) {
      lastRefresh = Date.now();
      await refreshExpiringTokens();
    }
    const due = await prisma.socialPost.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } }, take: 20 });
    for (const post of due) {
      // Claim first, so two server instances can't both publish it.
      const { count } = await prisma.socialPost.updateMany({ where: { id: post.id, status: "SCHEDULED" }, data: { status: "PUBLISHING" } });
      if (count) await publish(post);
    }
  };
  const timer = setInterval(() => tick().catch((err) => console.error("Social scheduler:", err)), 60_000);
  timer.unref();
  return timer;
}
