// GET/POST /api/admin/seed-token — password-protected one-time IG token seed.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, needCfg, readBody, sendHtml, sendJson, store, noBodyParse } from "../_http";
import { seedToken } from "../../lib/ig";
import { verifyPassword } from "../../lib/oauth";
import { errorPage, seedForm } from "../../lib/pages";

export const config = noBodyParse;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  const cfg = needCfg(res);
  if (!cfg) return;
  const method = (req.method || "").toUpperCase();

  if (method === "GET") {
    sendHtml(res, 200, seedForm());
    return;
  }
  if (method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  const { json, form } = await readBody(req);
  const get = (k: string): string =>
    typeof json[k] === "string" ? (json[k] as string) : form.get(k) ?? "";
  const wantsJson = String(req.headers["content-type"] || "").includes("application/json");
  if (!verifyPassword(get("password"), cfg.adminPassword)) {
    await new Promise((r) => setTimeout(r, 500));
    return wantsJson ? sendJson(res, 401, { ok: false, error: "Unauthorized." }) : sendHtml(res, 401, errorPage("Unauthorized."));
  }
  try {
    const out = await seedToken({ cfg, store: store() }, get("token"), get("user_id") || undefined);
    const body = { ok: true, user_id: out.userId, expires_at: out.expiresAt, refreshed: out.refreshed };
    return wantsJson ? sendJson(res, 200, body) : sendHtml(res, 200, `<!doctype html><meta charset="utf-8"><title>ig-mcp</title><body><p>Token saved.</p></body>`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return wantsJson ? sendJson(res, 400, { ok: false, error: msg }) : sendHtml(res, 400, errorPage(msg));
  }
}
