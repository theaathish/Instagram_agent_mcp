// GET /api/cron/refresh — Vercel Cron (every 30 days). Guarded by CRON_SECRET.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { needCfg, sendJson, store } from "../../lib/http";
import { refreshTokenIfNeeded } from "../../lib/ig";

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
    const r = await refreshTokenIfNeeded({ cfg, store: store() });
    sendJson(res, 200, { ok: true, ...r });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
