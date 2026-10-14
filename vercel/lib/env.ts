// Runtime config from environment variables.
// Secrets are set in the Vercel dashboard (or `vercel env add`); KV/Blob
// tokens are auto-provisioned when you add Storage integrations.

export const DEFAULT_API_VERSION = "v26.0";
export const DEFAULT_GRAPH_BASE = "https://graph.instagram.com";

export interface Cfg {
  adminPassword: string;
  igUserId: string;
  igSeedToken?: string;
  brandStyle?: string;
  hfToken?: string;
  oauthJwtSecret: string;
  cronSecret?: string;
  apiVersion: string;
  graphBase: string;
  publicImageBaseUrl?: string;
  firebaseDatabaseUrl?: string;
  firebaseAuthSecret?: string;
  metaAppId?: string;
  metaAppSecret?: string;
}

function req(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing required env var ${name}.`);
  return v;
}

export function loadCfg(): Cfg {
  return {
    adminPassword: req("ADMIN_PASSWORD"),
    igUserId: process.env.IG_USER_ID || "default",
    igSeedToken: process.env.IG_LONG_LIVED_TOKEN || undefined,
    brandStyle: process.env.BRAND_STYLE || undefined,
    hfToken: process.env.HF_TOKEN || undefined,
    oauthJwtSecret: req("OAUTH_JWT_SECRET"),
    cronSecret: process.env.CRON_SECRET || undefined,
    apiVersion: process.env.IG_API_VERSION || DEFAULT_API_VERSION,
    graphBase: (process.env.IG_GRAPH_BASE || DEFAULT_GRAPH_BASE).replace(/\/+$/, ""),
    publicImageBaseUrl: process.env.PUBLIC_IMAGE_BASE_URL || undefined,
    firebaseDatabaseUrl: process.env.FIREBASE_DATABASE_URL || undefined,
    firebaseAuthSecret: process.env.FIREBASE_AUTH_SECRET || undefined,
    metaAppId: process.env.META_APP_ID || process.env.FACEBOOK_APP_ID || undefined,
    metaAppSecret: process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || undefined,
  };
}

/** Public origin of the deployment, e.g. https://ig-mcp.vercel.app */
export function originOf(host: string | undefined, proto = "https"): string {
  return `${proto}://${host || "localhost:3000"}`;
}
