import { env } from "../../config/env.ts";

/* ------------------------------------------------------------------ *
 * Thin clients for the two places pieces get posted: Instagram (the
 * "Instagram API with Instagram Login" — no Facebook Page needed) and
 * Threads. Both use the same shape: log in → short token → 60-day token
 * (renewable) → publish a photo in two steps (create, then publish).
 * ------------------------------------------------------------------ */

export type Provider = "instagram" | "threads";

export class PlatformError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
  }
  /** Token expired or was revoked (the person removed the app, changed password…). */
  get isAuth() {
    return this.code === 190 || this.code === 102;
  }
}

type ErrorBody = { error?: { message: string; code: number; error_user_msg?: string } | string; error_message?: string };

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & ErrorBody;
  if (!res.ok || json.error) {
    const e = json.error;
    const message = typeof e === "string" ? (json.error_message ?? e) : (e?.error_user_msg ?? e?.message ?? res.statusText);
    throw new PlatformError(message, typeof e === "object" ? e?.code : undefined);
  }
  return json;
}

const get = async <T>(url: string, params: Record<string, string>) => parse<T>(await fetch(`${url}?${new URLSearchParams(params)}`));
const post = async <T>(url: string, params: Record<string, string>) =>
  parse<T>(await fetch(url, { method: "POST", body: new URLSearchParams(params) }));

/* ------------------------------------------------------------ Per platform */

const PLATFORM = {
  instagram: {
    appId: () => env.INSTAGRAM_APP_ID,
    appSecret: () => env.INSTAGRAM_APP_SECRET,
    authorize: "https://www.instagram.com/oauth/authorize",
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    shortToken: "https://api.instagram.com/oauth/access_token",
    host: "https://graph.instagram.com",
    api: () => `https://graph.instagram.com/${env.INSTAGRAM_GRAPH_VERSION}`,
    exchangeGrant: "ig_exchange_token",
    refreshGrant: "ig_refresh_token",
  },
  threads: {
    appId: () => env.THREADS_APP_ID,
    appSecret: () => env.THREADS_APP_SECRET,
    authorize: "https://threads.net/oauth/authorize",
    scopes: ["threads_basic", "threads_content_publish"],
    shortToken: "https://graph.threads.net/oauth/access_token",
    host: "https://graph.threads.net",
    api: () => "https://graph.threads.net/v1.0",
    exchangeGrant: "th_exchange_token",
    refreshGrant: "th_refresh_token",
  },
} as const;

export const PROVIDER_NAME: Record<Provider, string> = { instagram: "Instagram", threads: "Threads" };

export const isConfigured = (p: Provider) => Boolean(PLATFORM[p].appId() && PLATFORM[p].appSecret());

/** Both platforms send people back to this one address; the signed state says which it was. */
export const redirectUri = () => `${env.API_URL}/api/admin/social/callback`;

export function loginUrl(p: Provider, state: string) {
  const c = PLATFORM[p];
  const params = new URLSearchParams({
    client_id: c.appId()!,
    redirect_uri: redirectUri(),
    scope: c.scopes.join(","),
    response_type: "code",
    state,
  });
  return `${c.authorize}?${params}`;
}

type Token = { token: string; expiresAt: Date | null };
const expiry = (seconds?: number) => (seconds ? new Date(Date.now() + seconds * 1000) : null);

/** code → short-lived token → long-lived (60-day) token. */
export async function exchangeCode(p: Provider, code: string): Promise<Token> {
  const c = PLATFORM[p];
  const short = await post<{ access_token?: string; data?: { access_token: string }[] }>(c.shortToken, {
    client_id: c.appId()!,
    client_secret: c.appSecret()!,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    code,
  });
  // Instagram has answered both flat and wrapped in data[] over time.
  const shortToken = short.access_token ?? short.data?.[0]?.access_token;
  if (!shortToken) throw new PlatformError(`${PROVIDER_NAME[p]} didn't return an access token.`);
  const long = await get<{ access_token: string; expires_in?: number }>(`${c.host}/access_token`, {
    grant_type: c.exchangeGrant,
    client_secret: c.appSecret()!,
    access_token: shortToken,
  });
  return { token: long.access_token, expiresAt: expiry(long.expires_in) };
}

/** Pushes a still-valid long-lived token out another 60 days. */
export async function refreshToken(p: Provider, token: string): Promise<Token> {
  const c = PLATFORM[p];
  const res = await get<{ access_token: string; expires_in?: number }>(`${c.host}/refresh_access_token`, {
    grant_type: c.refreshGrant,
    access_token: token,
  });
  return { token: res.access_token, expiresAt: expiry(res.expires_in) };
}

/** Whose account this is — the id posts are published under, and the @handle. */
export async function whoAmI(p: Provider, token: string) {
  if (p === "instagram") {
    const me = await get<{ user_id?: string; id: string; username?: string; account_type?: string }>(`${PLATFORM.instagram.api()}/me`, {
      fields: "user_id,username,account_type",
      access_token: token,
    });
    return { accountId: me.user_id ?? me.id, username: me.username ?? null };
  }
  const me = await get<{ id: string; username?: string }>(`${PLATFORM.threads.api()}/me`, { fields: "id,username", access_token: token });
  return { accountId: me.id, username: me.username ?? null };
}

/* ------------------------------------------------------------ Publishing */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Both platforms download and process the image in the background; wait until it's ready. */
async function waitUntilReady(p: Provider, containerId: string, token: string) {
  const field = p === "instagram" ? "status_code" : "status";
  for (let i = 0; i < 20; i++) {
    const res = await get<Record<string, string | undefined>>(`${PLATFORM[p].api()}/${containerId}`, { fields: field, access_token: token });
    const status = res[field];
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new PlatformError(
        p === "instagram"
          ? "Instagram couldn't use the photo. It must be a public JPEG, between 4:5 and 1.91:1 for feed posts."
          : "Threads couldn't use the photo. It must be a public JPEG or PNG under 8MB.",
      );
    }
    await sleep(3000);
  }
  throw new PlatformError(`${PROVIDER_NAME[p]} took too long to process the photo. Try again in a minute.`);
}

export async function publishInstagram(accountId: string, token: string, input: { imageUrl: string; caption: string; story: boolean }) {
  const api = PLATFORM.instagram.api();
  const container = await post<{ id: string }>(`${api}/${accountId}/media`, {
    image_url: input.imageUrl,
    ...(input.story ? { media_type: "STORIES" } : { caption: input.caption }),
    access_token: token,
  });
  await waitUntilReady("instagram", container.id, token);
  const published = await post<{ id: string }>(`${api}/${accountId}/media_publish`, { creation_id: container.id, access_token: token });
  const { permalink } = await get<{ permalink?: string }>(`${api}/${published.id}`, { fields: "permalink", access_token: token }).catch(() => ({
    permalink: undefined,
  }));
  return { externalId: published.id, permalink };
}

/** Threads posts are capped at 500 characters. */
export const THREADS_MAX_TEXT = 500;

export async function publishThreads(accountId: string, token: string, input: { imageUrl: string; text: string }) {
  const api = PLATFORM.threads.api();
  const container = await post<{ id: string }>(`${api}/${accountId}/threads`, {
    media_type: "IMAGE",
    image_url: input.imageUrl,
    text: input.text,
    access_token: token,
  });
  await waitUntilReady("threads", container.id, token);
  const published = await post<{ id: string }>(`${api}/${accountId}/threads_publish`, { creation_id: container.id, access_token: token });
  const { permalink } = await get<{ permalink?: string }>(`${api}/${published.id}`, { fields: "permalink", access_token: token }).catch(() => ({
    permalink: undefined,
  }));
  return { externalId: published.id, permalink };
}
