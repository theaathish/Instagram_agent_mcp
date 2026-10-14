// Admin API for managing connected Instagram accounts in Firebase Realtime Database.
// GET /api/admin/accounts — List accounts
// POST /api/admin/accounts — Verify & link a new account via token
// PUT /api/admin/accounts — Set active default account
// DELETE /api/admin/accounts?id=<ig_user_id> — Disconnect an account

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, needCfg, readBody, reqOrigin, sendJson } from "../../lib/http";
import { verifyPassword, bearerToken, checkAccessToken } from "../../lib/oauth";
import { createFirebaseStore, type AccountRecord, type AccountStore } from "../../lib/firebase";
import { graphCall } from "../../lib/graph";

async function isAuthorized(req: VercelRequest, cfg: any, origin: string): Promise<boolean> {
  const headerPass = req.headers["x-admin-password"] as string;
  if (headerPass && verifyPassword(headerPass, cfg.adminPassword)) return true;

  const authHeader = bearerToken({ headers: req.headers as Record<string, unknown> });
  if (authHeader) {
    if (verifyPassword(authHeader, cfg.adminPassword)) return true;
    const tokenOk = await checkAccessToken(cfg, origin, authHeader);
    if (tokenOk) return true;
  }
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  const cfg = needCfg(res);
  if (!cfg) return;

  const origin = reqOrigin(req);
  const authed = await isAuthorized(req, cfg, origin);
  if (!authed) {
    sendJson(res, 401, { ok: false, error: "Unauthorized. Provide admin password or Bearer token." });
    return;
  }

  const store: AccountStore = createFirebaseStore(cfg.firebaseDatabaseUrl, undefined, cfg.firebaseAuthSecret);
  const method = (req.method || "").toUpperCase();

  try {
    if (method === "GET") {
      const all = await store.listAccounts();
      const sanitized = all.map((a) => {
        const daysLeft = a.token_expires_at
          ? Math.max(0, Math.round((a.token_expires_at * 1000 - Date.now()) / (24 * 3600 * 1000)))
          : null;
        return {
          ig_user_id: a.ig_user_id,
          username: a.username,
          account_type: a.account_type,
          is_default: !!a.is_default,
          token_expires_days: daysLeft,
          status: a.status ?? "active",
          brand_style: a.brand_style,
          connected_at: a.connected_at,
          publish_budget: a.publish_budget,
        };
      });
      sendJson(res, 200, { ok: true, count: sanitized.length, accounts: sanitized });
      return;
    }

    if (method === "POST") {
      const { json } = await readBody(req);
      const token = String(json["token"] || json["access_token"] || "").trim();
      const brandStyle = typeof json["brand_style"] === "string" ? json["brand_style"] : undefined;
      const makeDefault = Boolean(json["is_default"]);

      if (!token) {
        sendJson(res, 400, { ok: false, error: "Missing required 'token' parameter." });
        return;
      }

      let userId = "";
      let username = "";
      let accountType = "BUSINESS";

      // 1. Query Instagram Graph API
      try {
        const me = await graphCall(
          { base: cfg.graphBase, version: cfg.apiVersion, token, fetchFn: globalThis.fetch },
          "GET",
          "me",
          { fields: "id,username,account_type" },
        );
        userId = String(me["id"] || "");
        username = String(me["username"] || userId);
        accountType = String(me["account_type"] || "BUSINESS");
      } catch {
        // 2. Fallback: try graph.facebook.com in case it's a Meta/Facebook user token
        try {
          const fbRes = await graphCall(
            { base: "https://graph.facebook.com", version: "v22.0", token, fetchFn: globalThis.fetch },
            "GET",
            "me",
            { fields: "id,username,name" },
          );
          userId = String(fbRes["id"] || "");
          username = String(fbRes["username"] || fbRes["name"] || userId);

          // Check if there are connected IG business accounts on managed pages
          const pagesRes = await graphCall(
            { base: "https://graph.facebook.com", version: "v22.0", token, fetchFn: globalThis.fetch },
            "GET",
            "me/accounts",
            { fields: "id,name,instagram_business_account{id,username,account_type}" },
          );
          const data = (Array.isArray(pagesRes["data"]) ? pagesRes["data"] : []) as Array<{
            instagram_business_account?: { id?: string; username?: string; account_type?: string };
          }>;
          for (const item of data) {
            if (item.instagram_business_account?.id) {
              userId = item.instagram_business_account.id;
              username = item.instagram_business_account.username || username;
              accountType = item.instagram_business_account.account_type || "BUSINESS";
              break;
            }
          }
        } catch {
          // both endpoints exhausted
        }
      }

      if (!userId) {
        sendJson(res, 400, { ok: false, error: "Meta API did not return an account id for this token. Please check that the token is valid." });
        return;
      }

      const existingAccounts = await store.listAccounts();
      const isFirst = existingAccounts.length === 0;

      const record: AccountRecord = {
        ig_user_id: userId,
        username,
        account_type: accountType,
        access_token: token,
        token_expires_at: Math.floor(Date.now() / 1000) + 60 * 86400, // 60 days standard Meta long-lived
        brand_style: brandStyle,
        is_default: makeDefault || isFirst,
        status: "active",
        connected_at: Math.floor(Date.now() / 1000),
      };

      await store.saveAccount(record);
      if (record.is_default) {
        await store.setDefaultAccount(userId);
      }

      sendJson(res, 200, {
        ok: true,
        message: `Account @${username} (${userId}) successfully connected.`,
        account: {
          ig_user_id: userId,
          username,
          account_type: accountType,
          is_default: record.is_default,
        },
      });
      return;
    }

    if (method === "PUT") {
      const { json } = await readBody(req);
      const target = String(json["active_account_id"] || json["account"] || json["id"] || "").trim();
      if (!target) {
        sendJson(res, 400, { ok: false, error: "Missing 'account' or 'active_account_id'." });
        return;
      }
      const ok = await store.setDefaultAccount(target);
      if (!ok) {
        sendJson(res, 404, { ok: false, error: `Account "${target}" not found.` });
        return;
      }
      sendJson(res, 200, { ok: true, active_account_id: target });
      return;
    }

    if (method === "DELETE") {
      const { json } = await readBody(req);
      const id = String(req.query.id || json["id"] || "").trim();
      if (!id) {
        sendJson(res, 400, { ok: false, error: "Missing 'id' parameter in query or body." });
        return;
      }
      await store.deleteAccount(id);
      sendJson(res, 200, { ok: true, message: `Account ${id} disconnected.`, id });
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed." });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, 500, { ok: false, error: msg });
  }
}
