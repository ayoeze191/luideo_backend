import { env } from "../../config/env.ts";
import { HttpError } from "../../lib/http-error.ts";

/* ------------------------------------------------------------------ *
 * Thin client for the Meta Graph API (Facebook Pages + Instagram).
 * ------------------------------------------------------------------ */

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
];

export const metaConfigured = () => Boolean(env.META_APP_ID && env.META_APP_SECRET);

export const redirectUri = () => `${env.API_URL}/api/admin/social/callback`;

const graph = (path: string) => `https://graph.facebook.com/${env.META_GRAPH_VERSION}${path}`;

export class MetaError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
  }
  /** Token expired, revoked, or the password was changed. */
  get isAuth() {
    return this.code === 190 || this.code === 102;
  }
}

type GraphErrorBody = { error?: { message: string; code: number; error_user_msg?: string } };

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
  if (!res.ok || json.error) {
    throw new MetaError(json.error?.error_user_msg ?? json.error?.message ?? res.statusText, json.error?.code);
  }
  return json;
}

export async function graphGet<T>(path: string, params: Record<string, string>) {
  return parse<T>(await fetch(`${graph(path)}?${new URLSearchParams(params)}`));
}

export async function graphPost<T>(path: string, params: Record<string, string>) {
  return parse<T>(await fetch(graph(path), { method: "POST", body: new URLSearchParams(params) }));
}

export function loginDialogUrl(state: string) {
  if (!metaConfigured()) throw new HttpError(503, "Facebook isn't configured yet — add META_APP_ID and META_APP_SECRET.", "META_DISABLED");
  const params = new URLSearchParams({
    client_id: env.META_APP_ID!,
    redirect_uri: redirectUri(),
    state,
    response_type: "code",
    // Facebook Login for Business apps take a configuration (set up in the Meta
    // dashboard with the same permissions) instead of a list of scopes.
    ...(env.META_CONFIG_ID ? { config_id: env.META_CONFIG_ID } : { scope: META_SCOPES.join(",") }),
  });
  return `https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth?${params}`;
}

/** code → short-lived user token → long-lived (~60 day) user token. */
export async function exchangeCode(code: string) {
  const short = await graphGet<{ access_token: string }>("/oauth/access_token", {
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    redirect_uri: redirectUri(),
    code,
  });
  const long = await graphGet<{ access_token: string; expires_in?: number }>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    fb_exchange_token: short.access_token,
  });
  return {
    token: long.access_token,
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null,
  };
}

export type MetaPage = {
  id: string;
  name: string;
  /** Page tokens minted from a long-lived user token don't expire. */
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
};

export async function listPages(userToken: string) {
  const res = await graphGet<{ data: MetaPage[] }>("/me/accounts", {
    access_token: userToken,
    fields: "id,name,access_token,instagram_business_account{id,username}",
    limit: "100",
  });
  return res.data;
}
