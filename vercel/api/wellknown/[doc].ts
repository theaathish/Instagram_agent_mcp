// Single discovery function for both well-known documents.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, reqOrigin, sendJson } from "../../lib/http";
import { authServerMetadata, protectedResourceMetadata } from "../../lib/oauth";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  const doc = Array.isArray(req.query.doc) ? req.query.doc[0] : String(req.query.doc ?? "");
  const origin = reqOrigin(req);
  if (doc === "resource") {
    sendJson(res, 200, protectedResourceMetadata(origin));
    return;
  }
  if (doc === "authserver") {
    sendJson(res, 200, authServerMetadata(origin));
    return;
  }
  sendJson(res, 404, { error: "Unknown document." });
}
