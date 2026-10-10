// GET /api/openapi.json — OpenAPI 3.1 for Custom GPT Actions.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, reqOrigin, sendJson } from "./_http";
import { buildOpenApi } from "../lib/openapi";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  sendJson(res, 200, buildOpenApi(reqOrigin(req)));
}
