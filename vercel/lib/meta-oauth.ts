// Meta OAuth 2.0 flow for connecting Instagram Business accounts.
// Exchanges authorization codes, trades short-lived tokens for 60-day
// long-lived tokens, and discovers linked Instagram accounts via Facebook Pages.

import type { Cfg } from "./env";

export const DEFAULT_META_SCOPES = [
  "instagram_basic",
  "pages_show_list",
  "pages_read_engagement",
].join(",");

export const FULL_META_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
  "instagram_manage_insights",
  "instagram_manage_comments",
].join(",");

export interface DiscoveredAccount {
  ig_user_id: string;
  username: string;
  token: string;
  account_type?: string;
  token_expires_at?: number;
}

export function buildMetaAuthUrl(
  cfg: Cfg,
  origin: string,
  stateToken: string,
  requestedScope?: string,
): string {
  if (!cfg.metaAppId) {
    throw new Error("META_APP_ID environment variable is not configured.");
  }
  const redirectUri = `${origin}/api/admin/oauth/callback`;
  const scope = requestedScope || process.env.META_AUTH_SCOPES || DEFAULT_META_SCOPES;
  const params = new URLSearchParams({
    client_id: cfg.metaAppId,
    redirect_uri: redirectUri,
    state: stateToken,
    response_type: "code",
    scope,
  });
  return `https://www.facebook.com/v22.0/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForToken(
  cfg: Cfg,
  origin: string,
  code: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ access_token: string; expires_in?: number }> {
  if (!cfg.metaAppId || !cfg.metaAppSecret) {
    throw new Error("META_APP_ID or META_APP_SECRET is not configured.");
  }

  const redirectUri = `${origin}/api/admin/oauth/callback`;
  const codeParams = new URLSearchParams({
    client_id: cfg.metaAppId,
    client_secret: cfg.metaAppSecret,
    redirect_uri: redirectUri,
    code,
  });

  // 1. Exchange authorization code for short-lived access token
  const tokenRes = await fetchFn(`https://graph.facebook.com/v22.0/oauth/access_token?${codeParams.toString()}`);
  if (!tokenRes.ok) {
    const errBody = await tokenRes.text().catch(() => "");
    throw new Error(`Meta code exchange failed (${tokenRes.status}): ${errBody}`);
  }
  const tokenData = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  if (!tokenData.access_token) {
    throw new Error("No access_token returned from Meta code exchange.");
  }

  const shortToken = tokenData.access_token;

  // 2. Exchange short-lived token for long-lived (60-day) token
  try {
    const longParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: cfg.metaAppId,
      client_secret: cfg.metaAppSecret,
      fb_exchange_token: shortToken,
    });
    const longRes = await fetchFn(`https://graph.facebook.com/v22.0/oauth/access_token?${longParams.toString()}`);
    if (longRes.ok) {
      const longData = (await longRes.json()) as { access_token?: string; expires_in?: number };
      if (longData.access_token) {
        return {
          access_token: longData.access_token,
          expires_in: longData.expires_in ?? 5184000, // 60 days in seconds
        };
      }
    }
  } catch {
    // If exchange token fails, fall back to short-lived token
  }

  return { access_token: shortToken, expires_in: tokenData.expires_in };
}

export async function discoverInstagramAccounts(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<DiscoveredAccount[]> {
  const discovered: DiscoveredAccount[] = [];

  // 1. Query Facebook Pages to find connected instagram_business_account
  const pagesRes = await fetchFn(
    `https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,account_type}&access_token=${encodeURIComponent(token)}`,
  );

  if (pagesRes.ok) {
    const pagesData = (await pagesRes.json()) as {
      data?: Array<{
        id: string;
        name: string;
        access_token?: string;
        instagram_business_account?: {
          id: string;
          username: string;
          name?: string;
          account_type?: string;
        };
      }>;
    };

    if (Array.isArray(pagesData.data)) {
      for (const page of pagesData.data) {
        if (page.instagram_business_account?.id && page.instagram_business_account.username) {
          // Page tokens derived from long-lived user tokens do not expire;
          // use page.access_token if provided, otherwise the user token.
          const effectiveToken = page.access_token || token;
          discovered.push({
            ig_user_id: page.instagram_business_account.id,
            username: page.instagram_business_account.username.toLowerCase(),
            token: effectiveToken,
            account_type: page.instagram_business_account.account_type || "BUSINESS",
            token_expires_at: Date.now() + 60 * 24 * 60 * 60 * 1000,
          });
        }
      }
    }
  }

  // 2. Fallback: if no pages have an IG business account, check if token directly identifies an IG account
  if (discovered.length === 0) {
    try {
      const meRes = await fetchFn(
        `https://graph.facebook.com/v22.0/me?fields=id,username,account_type&access_token=${encodeURIComponent(token)}`,
      );
      if (meRes.ok) {
        const meData = (await meRes.json()) as { id?: string; username?: string; account_type?: string };
        if (meData.id && meData.username) {
          discovered.push({
            ig_user_id: meData.id,
            username: meData.username.toLowerCase(),
            token,
            account_type: meData.account_type || "BUSINESS",
            token_expires_at: Date.now() + 60 * 24 * 60 * 60 * 1000,
          });
        }
      }
    } catch {
      // ignore fallback error
    }
  }

  return discovered;
}
