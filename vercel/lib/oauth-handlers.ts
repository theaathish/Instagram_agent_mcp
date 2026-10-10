// OAuth route implementations shared by api/oauth/[action].ts.
// (One dynamic function file instead of three — Hobby caps at 12 functions.)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readBody, reqOrigin, sendHtml, sendJson, store } from "./http";
import { loadCfg } from "./env";
import {
  approveRequest,
  parseAuthorizeRequest,
  registerClient,
  tokenExchange,
} from "./oauth";
import { errorPage, loginPage } from "./pages";

function queryOf(req: VercelRequest): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(req.query ?? {})) out[k] = v as string | string[] | undefined;
  return out;
}

export async function handleRegister(req: VercelRequest, res: VercelResponse): Promise<void> {
  if ((req.method || "").toUpperCase() !== "POST") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }
  const { json } = await readBody(req);
  const out = await registerClient(store(), json);
  sendJson(res, out.status, out.body);
}

export async function handleAuthorize(req: VercelRequest, res: VercelResponse): Promise<void> {
  let cfg;
  try {
    cfg = loadCfg();
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    return;
  }
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
      // Spec-correct deny: bounce back to the client with access_denied.
      const raw = await store().get(`oauth:req:${get("req")}`).catch(() => null);
      if (raw) {
        try {
          const p = JSON.parse(raw) as { redirect_uri: string; state: string };
          await store().del(`oauth:req:${get("req")}`).catch(() => undefined);
          const u = new URL(p.redirect_uri);
          u.searchParams.set("error", "access_denied");
          u.searchParams.set("state", p.state || "");
          u.searchParams.set("iss", origin);
          res.redirect(302, u.toString());
          return;
        } catch {
          // fall through to the static page
        }
      }
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

export async function handleToken(req: VercelRequest, res: VercelResponse): Promise<void> {
  let cfg;
  try {
    cfg = loadCfg();
  } catch (e) {
    sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    return;
  }
  if ((req.method || "").toUpperCase() !== "POST") {
    sendJson(res, 405, { error: "unsupported_grant_type" });
    return;
  }
  const { json, form } = await readBody(req);
  const body: Record<string, unknown> = { ...json };
  if (Object.keys(body).length === 0) {
    form.forEach((v, k) => {
      body[k] = v;
    });
  }
  const out = await tokenExchange(store(), cfg, reqOrigin(req), body, req.headers as Record<string, unknown>);
  res.setHeader("cache-control", "no-store");
  res.setHeader("pragma", "no-cache");
  sendJson(res, out.status, out.body);
}
