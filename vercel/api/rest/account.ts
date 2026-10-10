// GET /api/rest/account — OAuth-guarded REST mirror of ig_me.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { guardAuth, maybeOptions, needCfg, reqOrigin, sendJson, store } from "../_http";
import { ig_me } from "../../lib/tools";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  const cfg = needCfg(res);
  if (!cfg) return;
  const origin = reqOrigin(req);
  if (!(await guardAuth(req, res, cfg, origin))) return;
  sendJson(res, 200, await ig_me({ deps: { cfg, store: store() }, origin }, {}));
}
