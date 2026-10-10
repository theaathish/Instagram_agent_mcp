// Single OAuth function: /api/oauth/authorize | /token | /register.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, sendJson, noBodyParse } from "../../lib/http";
import { handleAuthorize, handleRegister, handleToken } from "../../lib/oauth-handlers";

export const config = noBodyParse;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  const action = Array.isArray(req.query.action) ? req.query.action[0] : String(req.query.action ?? "");
  if (action === "authorize") {
    await handleAuthorize(req, res);
    return;
  }
  if (action === "token") {
    await handleToken(req, res);
    return;
  }
  if (action === "register") {
    await handleRegister(req, res);
    return;
  }
  sendJson(res, 404, { error: "Unknown OAuth endpoint." });
}
