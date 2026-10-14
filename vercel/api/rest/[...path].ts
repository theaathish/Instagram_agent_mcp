// Single REST function for all /api/rest/* routes.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, noBodyParse } from "../../lib/http";
import { handleRest } from "../../lib/rest-handler";

export const config = noBodyParse;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  await handleRest(req, res);
}
