// MCP endpoint (also reachable as /mcp via vercel.json rewrite).
// OAuth-guarded; stateless Streamable HTTP (fits Hobby 60s functions).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { guardAuth, maybeOptions, needCfg, reqOrigin, sendJson, store } from "./_http";
import { handleMcp, makeToolCtx } from "../lib/mcp";

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  const cfg = needCfg(res);
  if (!cfg) return;
  if (!["GET", "POST", "DELETE"].includes((req.method || "").toUpperCase())) {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  const origin = reqOrigin(req);
  const auth = await guardAuth(req, res, cfg, origin);
  if (!auth) return;
  try {
    await handleMcp(req, res, makeToolCtx(cfg, store(), origin));
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
