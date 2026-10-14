// GET /api/cron/refresh — Vercel Cron (every 30 days). Guarded by CRON_SECRET.
// Automatically refreshes tokens near expiration (< 35 days) across all accounts in Firebase.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { needCfg, sendJson, store } from "../../lib/http";
import { refreshToken, refreshTokenIfNeeded, REFRESH_WITHIN_DAYS } from "../../lib/ig";
import { createFirebaseStore } from "../../lib/firebase";

const DAY_MS = 24 * 3600 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if ((req.method || "").toUpperCase() !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  const cfg = needCfg(res);
  if (!cfg) return;
  if (!cfg.cronSecret) {
    sendJson(res, 500, { ok: false, error: "CRON_SECRET is not configured." });
    return;
  }
  const auth = String(req.headers.authorization || "");
  if (auth !== `Bearer ${cfg.cronSecret}`) {
    sendJson(res, 401, { ok: false, error: "Unauthorized." });
    return;
  }

  try {
    const acctStore = createFirebaseStore(cfg.firebaseDatabaseUrl, undefined, cfg.firebaseAuthSecret);
    const accounts = await acctStore.listAccounts();

    if (accounts.length > 0) {
      let refreshedCount = 0;
      const details: Array<{ username: string; refreshed: boolean; expires_at: number }> = [];

      for (const acc of accounts) {
        const expiresAt = acc.token_expires_at ? acc.token_expires_at * 1000 : 0;
        const daysLeft = expiresAt ? (expiresAt - Date.now()) / DAY_MS : 0;

        if (!expiresAt || daysLeft < REFRESH_WITHIN_DAYS) {
          try {
            const r = await refreshToken({ cfg, store: store() }, acc.access_token);
            acc.access_token = r.token;
            acc.token_expires_at = r.expiresAt;
            acc.last_refreshed_at = Math.floor(Date.now() / 1000);
            await acctStore.saveAccount(acc);
            refreshedCount++;
            details.push({ username: acc.username, refreshed: true, expires_at: r.expiresAt });
          } catch (err) {
            details.push({ username: acc.username, refreshed: false, expires_at: acc.token_expires_at || 0, error: err instanceof Error ? err.message : String(err) });
          }
        } else {
          details.push({ username: acc.username, refreshed: false, expires_at: acc.token_expires_at || 0 });
        }
      }

      sendJson(res, 200, {
        ok: true,
        refreshed_count: refreshedCount,
        total_accounts: accounts.length,
        accounts: details,
      });
      return;
    }

    // Fallback to single-account KV store
    const r = await refreshTokenIfNeeded({ cfg, store: store() });
    sendJson(res, 200, { ok: true, refreshed_count: r.refreshed ? 1 : 0, ...r });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
