// Worker environment bindings (see wrangler.jsonc).
// Secrets (wrangler secret put): ADMIN_PASSWORD, IG_USER_ID,
// IG_LONG_LIVED_TOKEN (one-time seed), BRAND_STYLE.

export interface Env {
  OAUTH_KV: KVNamespace;
  IG_KV: KVNamespace;
  AI: Ai;
  ADMIN_PASSWORD: string;
  IG_USER_ID: string;
  IG_LONG_LIVED_TOKEN?: string;
  BRAND_STYLE?: string;
  IG_API_VERSION?: string;
  IG_GRAPH_BASE?: string;
  IMAGE_MODEL?: string;
  PUBLIC_IMAGE_BASE_URL?: string;
}

export const DEFAULT_API_VERSION = "v26.0";
export const DEFAULT_GRAPH_BASE = "https://graph.instagram.com";
export const DEFAULT_IMAGE_MODEL =
  "@cf/black-forest-labs/flux-1-schnell";

export function apiVersion(env: Env): string {
  return env.IG_API_VERSION || DEFAULT_API_VERSION;
}

export function graphBase(env: Env): string {
  return (env.IG_GRAPH_BASE || DEFAULT_GRAPH_BASE).replace(/\/+$/, "");
}

export function imageModel(env: Env): string {
  return env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
}
