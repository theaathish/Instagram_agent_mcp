// Serverless handler for Meta OAuth: /api/admin/oauth/login and /api/admin/oauth/callback.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadCfg, originOf } from "../../../lib/env";
import { signJwt, verifyJwt } from "../../../lib/jwt";
import { verifyPassword } from "../../../lib/oauth";
import { createFirebaseStore } from "../../../lib/firebase";
import {
  buildMetaAuthUrl,
  exchangeCodeForToken,
  discoverInstagramAccounts,
  FULL_META_SCOPES,
} from "../../../lib/meta-oauth";
import { sendJson } from "../../../lib/http";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const cfg = loadCfg();
  const origin = originOf(req.headers["x-forwarded-host"] as string | undefined || req.headers.host);
  const action = Array.isArray(req.query.action) ? req.query.action[0] : String(req.query.action ?? "");

  if (action === "login") {
    // 1. Authorize admin
    const authHeader = (req.headers["x-admin-password"] as string) || (req.headers["authorization"] as string) || "";
    const queryToken = typeof req.query.admin_token === "string" ? req.query.admin_token : "";
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const providedSecret = queryToken || (bearerMatch ? bearerMatch[1].trim() : authHeader.trim());

    if (!verifyPassword(providedSecret, cfg.adminPassword)) {
      res.writeHead(302, { Location: "/admin?oauth_error=" + encodeURIComponent("Invalid admin password.") });
      res.end();
      return;
    }

    if (!cfg.metaAppId) {
      res.writeHead(302, { Location: "/admin?oauth_error=" + encodeURIComponent("META_APP_ID is not configured.") });
      res.end();
      return;
    }

    // 2. Mint short-lived state token (10 min TTL)
    const now = Math.floor(Date.now() / 1000);
    const state = signJwt(cfg.oauthJwtSecret, {
      sub: "meta_admin_oauth",
      iat: now,
      exp: now + 600,
    });

    const requestedScopeParam = typeof req.query.scope === "string" ? req.query.scope : "";
    let scopeToUse: string | undefined = undefined;
    if (requestedScopeParam === "full") {
      scopeToUse = FULL_META_SCOPES;
    } else if (requestedScopeParam && requestedScopeParam !== "basic" && requestedScopeParam !== "default") {
      scopeToUse = requestedScopeParam;
    }

    const redirectUrl = buildMetaAuthUrl(cfg, origin, state, scopeToUse);
    res.writeHead(302, { Location: redirectUrl });
    res.end();
    return;
  }

  if (action === "callback") {
    const error = req.query.error || req.query.error_description;
    if (error) {
      const msg = String(req.query.error_description || req.query.error);
      res.writeHead(302, { Location: "/admin?oauth_error=" + encodeURIComponent(msg) });
      res.end();
      return;
    }

    const state = String(req.query.state ?? "");
    const claims = verifyJwt(cfg.oauthJwtSecret, state);
    if (!claims || claims.sub !== "meta_admin_oauth") {
      res.writeHead(302, {
        Location: "/admin?oauth_error=" + encodeURIComponent("Session expired or invalid state. Please try again."),
      });
      res.end();
      return;
    }

    const code = String(req.query.code ?? "");
    if (!code) {
      res.writeHead(302, { Location: "/admin?oauth_error=" + encodeURIComponent("Missing authorization code.") });
      res.end();
      return;
    }

    try {
      const tokenResult = await exchangeCodeForToken(cfg, origin, code);
      const accounts = await discoverInstagramAccounts(tokenResult.access_token);

      if (accounts.length === 0) {
        res.writeHead(302, {
          Location:
            "/admin?oauth_error=" +
            encodeURIComponent(
              "No Instagram Professional/Business accounts found connected to your Facebook Pages. Please ensure your Instagram account is switched to Professional/Business and linked to a Facebook Page.",
            ),
        });
        res.end();
        return;
      }

      // Save discovered accounts to Firebase Realtime Database
      const store = createFirebaseStore(cfg.firebaseDatabaseUrl, fetch, cfg.firebaseAuthSecret);
      const existing = await store.listAccounts().catch(() => []);
      let activeSet = existing.some((a) => a.is_default);

      for (const acc of accounts) {
        const makeDefault = !activeSet;
        await store.saveAccount({
          ig_user_id: acc.ig_user_id,
          username: acc.username,
          access_token: acc.token,
          token_expires_at: acc.token_expires_at,
          account_type: acc.account_type || "BUSINESS",
          is_default: makeDefault,
          status: "active",
          connected_at: Date.now(),
        });
        if (makeDefault) {
          await store.setDefaultAccount(acc.ig_user_id).catch(() => false);
          activeSet = true;
        }
      }

      const usernames = accounts.map((a) => a.username).join(",");
      res.writeHead(302, {
        Location: `/admin?oauth_success=1&count=${accounts.length}&usernames=${encodeURIComponent(usernames)}`,
      });
      res.end();
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(302, { Location: "/admin?oauth_error=" + encodeURIComponent(msg) });
      res.end();
      return;
    }
  }

  sendJson(res, 404, { error: "Unknown endpoint" });
}
