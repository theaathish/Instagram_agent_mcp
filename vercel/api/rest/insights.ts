// GET /api/rest/insights?media_id=... — per-media insights.
// (Dedicated single-segment route: the platform does not route multi-segment
// REST paths to the catch-all, so the media id travels as a query param.)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, noBodyParse } from "../../lib/http";
import { handleMediaInsights } from "../../lib/rest-handler";

export const config = noBodyParse;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  if ((req.method || "").toUpperCase() !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }
  const raw = req.query.media_id;
  const mediaId = Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? "");
  await handleMediaInsights(req, res, mediaId);
}
