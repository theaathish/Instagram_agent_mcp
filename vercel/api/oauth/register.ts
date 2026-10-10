// POST /api/oauth/register — RFC 7591 dynamic client registration.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, needCfg, readBody, sendJson, store, noBodyParse } from "../_http";
import { registerClient } from "../../lib/oauth";

export const config = noBodyParse;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  if ((req.method || "").toUpperCase() !== "POST") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }
  if (!needCfg(res)) return;
  const { json } = await readBody(req);
  const out = await registerClient(store(), json);
  sendJson(res, out.status, out.body);
}
