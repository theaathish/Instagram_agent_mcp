// GET /.well-known/oauth-authorization-server (RFC 8414).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, reqOrigin, sendJson } from "../_http";
import { authServerMetadata } from "../../lib/oauth";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  sendJson(res, 200, authServerMetadata(reqOrigin(req)));
}
