import { env } from "../../config/env.ts";
import type { SocialPost, SocialTarget } from "../../generated/prisma/client.ts";
import { decrypt, encrypt } from "../../lib/crypto.ts";
import { badRequest, HttpError } from "../../lib/http-error.ts";
import { prisma } from "../../lib/prisma.ts";
import { instagramImageUrl } from "../uploads/uploads.ts";
import { MetaError, graphGet, graphPost, listPages, metaConfigured, type MetaPage } from "./meta.ts";

const ROW = "meta";

/* ------------------------------------------------------------ Connection */

export async function connectionStatus() {
  const row = await prisma.socialConnection.findUnique({ where: { id: ROW } });
  const base = { configured: metaConfigured(), needsPageChoice: Boolean(row?.userTokenEnc && !row.pageId) };

  if (!row?.pageId || !row.pageTokenEnc) {
    return { ...base, facebook: null, instagram: null, problem: null as string | null };
  }

  // A cheap live check, so a revoked token shows up here rather than at publish time.
  let problem: string | null = null;
  try {
    await graphGet(`/${row.pageId}`, { fields: "id", access_token: decrypt(row.pageTokenEnc) });
  } catch (err) {
    problem = err instanceof MetaError && err.isAuth ? "Facebook access has expired or was revoked — reconnect." : "Couldn't reach Facebook just now.";
  }

  return {
    ...base,
    facebook: { pageId: row.pageId, name: row.pageName },
    instagram: row.igUserId ? { userId: row.igUserId, username: row.igUsername } : null,
    problem,
  };
}

/** After OAuth: remember the user token, and pick the Page straight away if there's only one. */
export async function saveUserToken(userToken: string, expiresAt: Date | null, adminId: string) {
  const pages = await listPages(userToken);
  const data = { userTokenEnc: encrypt(userToken), userTokenExpiresAt: expiresAt, connectedById: adminId };
  await prisma.socialConnection.upsert({
    where: { id: ROW },
    create: { id: ROW, ...data },
    update: { ...data, pageId: null, pageName: null, pageTokenEnc: null, igUserId: null, igUsername: null },
  });
  if (pages.length === 1) await usePage(pages[0]!);
  return pages.length;
}

export async function pagesToChoose() {
  const row = await prisma.socialConnection.findUnique({ where: { id: ROW } });
  if (!row?.userTokenEnc) throw badRequest("Connect Facebook first.", "NOT_CONNECTED");
  const pages = await listPages(decrypt(row.userTokenEnc));
  return pages.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram_business_account?.username ?? null }));
}

export async function choosePage(pageId: string) {
  const row = await prisma.socialConnection.findUnique({ where: { id: ROW } });
  if (!row?.userTokenEnc) throw badRequest("Connect Facebook first.", "NOT_CONNECTED");
  const page = (await listPages(decrypt(row.userTokenEnc))).find((p) => p.id === pageId);
  if (!page) throw badRequest("That Page isn't available on this Facebook account.", "PAGE");
  await usePage(page);
}

async function usePage(page: MetaPage) {
  await prisma.socialConnection.update({
    where: { id: ROW },
    data: {
      pageId: page.id,
      pageName: page.name,
      pageTokenEnc: encrypt(page.access_token),
      igUserId: page.instagram_business_account?.id ?? null,
      igUsername: page.instagram_business_account?.username ?? null,
      // The page token is all we need from here on.
      userTokenEnc: null,
    },
  });
}

export async function disconnect() {
  await prisma.socialConnection.deleteMany({ where: { id: ROW } });
}

/* ------------------------------------------------------------ Publishing */

export const TARGET_IDS: Record<string, SocialTarget> = {
  "ig-feed": "IG_FEED",
  "ig-story": "IG_STORY",
  "fb-feed": "FB_FEED",
  "fb-story": "FB_STORY",
};
const TARGET_LABEL: Record<SocialTarget, string> = {
  IG_FEED: "Instagram feed",
  IG_STORY: "Instagram story",
  FB_FEED: "Facebook page",
  FB_STORY: "Facebook story",
};
export const targetId = (t: SocialTarget) => Object.entries(TARGET_IDS).find(([, v]) => v === t)![0];

/** Relative paths (e.g. /brand/coral-set.jpg) live on the storefront. */
const absolute = (url: string) => (url.startsWith("/") ? `${env.FRONTEND_URL}${url}` : url);

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
    throw badRequest("Instagram and Facebook can't download images from localhost. Use a public URL (deploy, or a tunnel like ngrok).", "IMAGE_NOT_PUBLIC");
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
    const conn = await prisma.socialConnection.findUnique({ where: { id: ROW } });
    if (!conn?.pageId || !conn.pageTokenEnc) throw new HttpError(400, "Facebook isn't connected.", "NOT_CONNECTED");
    const token = decrypt(conn.pageTokenEnc);

    let result: { externalId: string; permalink?: string };
    switch (post.target) {
      case "FB_FEED":
        result = await fbFeed(conn.pageId, token, post);
        break;
      case "FB_STORY":
        result = await fbStory(conn.pageId, token, post);
        break;
      default:
        if (!conn.igUserId) throw new HttpError(400, "No Instagram business account is linked to this Facebook Page.", "NO_INSTAGRAM");
        result = await instagram(conn.igUserId, token, post);
        break;
    }
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

async function fbFeed(pageId: string, token: string, post: SocialPost) {
  const message = [post.caption, post.link].filter(Boolean).join("\n\n");
  const res = await graphPost<{ id: string; post_id?: string }>(`/${pageId}/photos`, { url: post.imageUrl, caption: message, access_token: token });
  const id = res.post_id ?? res.id;
  return { externalId: id, permalink: `https://www.facebook.com/${id}` };
}

async function fbStory(pageId: string, token: string, post: SocialPost) {
  // Stories take an unpublished photo that's already uploaded to the Page.
  const photo = await graphPost<{ id: string }>(`/${pageId}/photos`, { url: post.imageUrl, published: "false", access_token: token });
  const story = await graphPost<{ post_id?: string; success?: boolean }>(`/${pageId}/photo_stories`, { photo_id: photo.id, access_token: token });
  return { externalId: story.post_id ?? photo.id };
}

async function instagram(igUserId: string, token: string, post: SocialPost) {
  const story = post.target === "IG_STORY";
  const container = await graphPost<{ id: string }>(`/${igUserId}/media`, {
    image_url: instagramImageUrl(post.imageUrl),
    ...(story ? { media_type: "STORIES" } : { caption: post.caption }),
    access_token: token,
  });

  // Instagram fetches and processes the image asynchronously.
  for (let i = 0; i < 15; i++) {
    const { status_code } = await graphGet<{ status_code: string }>(`/${container.id}`, { fields: "status_code", access_token: token });
    if (status_code === "FINISHED") break;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new Error("Instagram couldn't process the image. It must be a public JPEG, between 4:5 and 1.91:1 for feed posts.");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const published = await graphPost<{ id: string }>(`/${igUserId}/media_publish`, { creation_id: container.id, access_token: token });
  const { permalink } = await graphGet<{ permalink?: string }>(`/${published.id}`, { fields: "permalink", access_token: token }).catch(() => ({ permalink: undefined }));
  return { externalId: published.id, permalink };
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

/** Instagram's API has no native scheduling, so we run our own: every minute, publish what's due. */
export function startSocialScheduler() {
  const tick = async () => {
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
