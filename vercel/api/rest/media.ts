// GET /api/rest/media?limit= — OAuth-guarded mirror of ig_list_media.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { guardAuth, maybeOptions, needCfg, reqOrigin, sendJson, store } from "../_http";
import { S_ig_list_media, ig_list_media } from "../../lib/tools";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  const cfg = needCfg(res);
  if (!cfg) return;
  const origin = reqOrigin(req);
  if (!(await guardAuth(req, res, cfg, origin))) return;
  const raw = req.query.limit;
  const parsed = S_ig_list_media.safeParse({ limit: raw === undefined ? undefined : Number(Array.isArray(raw) ? raw[0] : raw) });
  if (!parsed.success) {
    sendJson(res, 400, { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  sendJson(res, 200, await ig_list_media({ deps: { cfg, store: store() }, origin }, parsed.data));
}
