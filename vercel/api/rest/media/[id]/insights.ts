// GET /api/rest/media/[id]/insights — OAuth-guarded mirror of ig_media_insights.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { guardAuth, maybeOptions, needCfg, reqOrigin, sendJson, store } from "../../../_http";
import { ig_media_insights } from "../../../../lib/tools";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  const cfg = needCfg(res);
  if (!cfg) return;
  const origin = reqOrigin(req);
  if (!(await guardAuth(req, res, cfg, origin))) return;
  const id = req.query.id;
  const media_id = Array.isArray(id) ? id[0] : String(id ?? "");
  if (!media_id) {
    sendJson(res, 400, { ok: false, error: "Missing media id." });
    return;
  }
  sendJson(res, 200, await ig_media_insights({ deps: { cfg, store: store() }, origin }, { media_id }));
}
