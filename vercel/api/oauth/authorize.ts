// GET/POST /api/oauth/authorize — single-user login + consent.
// GET validates the request and shows the password page; POST checks
// ADMIN_PASSWORD and issues the authorization code.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { maybeOptions, needCfg, readBody, reqOrigin, sendHtml, sendJson, store, noBodyParse } from "../_http";
import { approveRequest, parseAuthorizeRequest } from "../../lib/oauth";
import { errorPage, loginPage } from "../../lib/pages";

export const config = noBodyParse;

function queryOf(req: VercelRequest): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(req.query ?? {})) out[k] = v as string | string[] | undefined;
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (maybeOptions(req, res)) return;
  const cfg = needCfg(res);
  if (!cfg) return;
  const origin = reqOrigin(req);
  const method = (req.method || "").toUpperCase();

  if (method === "GET") {
    const parsed = await parseAuthorizeRequest(store(), origin, queryOf(req));
    if (!parsed.ok) {
      if (parsed.redirectTo) {
        res.redirect(302, parsed.redirectTo);
        return;
      }
      sendHtml(res, 400, errorPage(parsed.message));
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("x-frame-options", "DENY");
    res.status(200).send(loginPage(parsed.clientName, parsed.redirectHost, parsed.redirectIsLoopback, parsed.pendingId, parsed.scope));
    return;
  }

  if (method === "POST") {
    const { json, form } = await readBody(req);
    const get = (k: string): string =>
      typeof json[k] === "string" ? (json[k] as string) : form.get(k) ?? "";
    if (get("decision") !== "approve") {
      sendHtml(res, 200, errorPage("Access denied. You can close this window."));
      return;
    }
    const out = await approveRequest(store(), cfg, origin, get("req"), get("password"));
    if ("error" in out) {
      sendHtml(res, 401, errorPage(out.error));
      return;
    }
    res.redirect(302, out.redirectTo);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
}
