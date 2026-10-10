// POST /api/rest/post — OAuth-guarded mirror of ig_post (dry_run default true).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { guardAuth, maybeOptions, needCfg, readBody, reqOrigin, sendJson, store, noBodyParse } from "../_http";
import { S_ig_post, ig_post } from "../../lib/tools";

export const config = noBodyParse;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  const cfg = needCfg(res);
  if (!cfg) return;
  const origin = reqOrigin(req);
  if (!(await guardAuth(req, res, cfg, origin))) return;
  if ((req.method || "").toUpperCase() !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  const { json } = await readBody(req);
  const parsed = S_ig_post.safeParse(json);
  if (!parsed.success) {
    sendJson(res, 400, { ok: false, error: parsed.error.issues.map((i: { message: string }) => i.message).join("; ") });
    return;
  }
  sendJson(res, 200, await ig_post({ deps: { cfg, store: store() }, origin }, parsed.data));
}
