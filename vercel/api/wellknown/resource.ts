// GET /.well-known/oauth-protected-resource (RFC 9728).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, reqOrigin, sendJson } from "../_http";
import { protectedResourceMetadata } from "../../lib/oauth";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  sendJson(res, 200, protectedResourceMetadata(reqOrigin(req)));
}
