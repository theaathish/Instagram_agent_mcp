// Admin API for managing integration API keys in Firebase Realtime Database.
// GET    /api/admin/keys — List all API keys
// POST   /api/admin/keys — Create a new scoped API key
// DELETE /api/admin/keys?id=<id> — Revoke an API key

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, needCfg, readBody, reqOrigin, sendJson } from "../../lib/http";
import { verifyPassword, bearerToken, checkAccessToken } from "../../lib/oauth";
import { createFirebaseStore, type AccountStore } from "../../lib/firebase";

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
      const keys = await store.listApiKeys();
      // Mask keys in list for safety
      const safeKeys = keys.map((k) => ({
        id: k.id,
        name: k.name,
        account: k.account || null,
        created_at: k.created_at,
        last_used_at: k.last_used_at || null,
        status: k.status,
        masked_key: `${k.key.slice(0, 11)}...${k.key.slice(-4)}`,
      }));
      sendJson(res, 200, { ok: true, keys: safeKeys });
      return;
    }

    if (method === "POST") {
      const { json } = await readBody(req);
      const name = String(json.name || "API Key").trim();
      const account = typeof json.account === "string" && json.account.trim() ? json.account.trim() : undefined;

      const created = await store.createApiKey(name, account);
      sendJson(res, 201, {
        ok: true,
        message: "API key created successfully.",
        key_record: created,
      });
      return;
    }

    if (method === "DELETE") {
      const id = typeof req.query.id === "string" ? req.query.id : "";
      if (!id) {
        sendJson(res, 400, { ok: false, error: "Missing required query parameter: id" });
        return;
      }
      const ok = await store.revokeApiKey(id);
      if (!ok) {
        sendJson(res, 404, { ok: false, error: "API key not found." });
        return;
      }
      sendJson(res, 200, { ok: true, message: "API key revoked successfully." });
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed." });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { ok: false, error: msg });
  }
}
