// POST /api/oauth/token — code exchange (PKCE) + refresh rotation.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, needCfg, readBody, reqOrigin, sendJson, store, noBodyParse } from "../_http";
import { tokenExchange } from "../../lib/oauth";

export const config = noBodyParse;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  const cfg = needCfg(res);
  if (!cfg) return;
  if ((req.method || "").toUpperCase() !== "POST") {
    sendJson(res, 405, { error: "unsupported_grant_type" });
    return;
  }
  const { json, form } = await readBody(req);
  const body: Record<string, unknown> = { ...json };
  if (Object.keys(body).length === 0) {
    form.forEach((v, k) => {
      body[k] = v;
    });
  }
  const out = await tokenExchange(store(), cfg, reqOrigin(req), body, req.headers as Record<string, unknown>);
  res.setHeader("cache-control", "no-store");
  res.setHeader("pragma", "no-cache");
  sendJson(res, out.status, out.body);
}
