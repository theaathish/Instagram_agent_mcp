// All REST mirrors behind one function: /api/rest/*.
// (One catch-all file instead of six — Hobby caps at 12 functions.)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { guardAuth, needCfg, readBody, reqOrigin, sendJson, store } from "./http";
import type { Cfg } from "./env";
import { makeToolCtx } from "./mcp";
import {
  S_ig_generate_and_post,
  S_ig_generate_image,
  S_ig_list_media,
  S_ig_post,
  ig_generate_and_post,
  ig_generate_image,
  ig_list_media,
  ig_me,
  ig_media_insights,
  ig_post,
  type ToolCtx,
} from "./tools";

async function authed(req: VercelRequest, res: VercelResponse): Promise<{ ctx: ToolCtx } | null> {
  const cfg: Cfg | null = needCfg(res);
  if (!cfg) return null;
  const origin = reqOrigin(req);
  if (!(await guardAuth(req, res, cfg, origin))) return null;
  return { ctx: makeToolCtx(cfg, store(), origin) };
}

function invalid(res: VercelResponse, issues: Array<{ message: string }>): void {
  sendJson(res, 400, { ok: false, error: issues.map((i) => i.message).join("; ") });
}

async function handleAccount(req: VercelRequest, res: VercelResponse): Promise<void> {
  const a = await authed(req, res);
  if (!a) return;
  const account = typeof req.query.account === "string" ? req.query.account : undefined;
  sendJson(res, 200, await ig_me(a.ctx, { account }));
}

async function handleMediaList(req: VercelRequest, res: VercelResponse): Promise<void> {
  const a = await authed(req, res);
  if (!a) return;
  const raw = req.query.limit;
  const account = typeof req.query.account === "string" ? req.query.account : undefined;
  const parsed = S_ig_list_media.safeParse({
    limit: raw === undefined ? undefined : Number(Array.isArray(raw) ? raw[0] : raw),
    account,
  });
  if (!parsed.success) {
    invalid(res, parsed.error.issues);
    return;
  }
  sendJson(res, 200, await ig_list_media(a.ctx, parsed.data));
}

export async function handleMediaInsights(req: VercelRequest, res: VercelResponse, mediaId: string): Promise<void> {
  const a = await authed(req, res);
  if (!a) return;
  if (!mediaId) {
    sendJson(res, 400, { ok: false, error: "Missing media id." });
    return;
  }
  const account = typeof req.query.account === "string" ? req.query.account : undefined;
  sendJson(res, 200, await ig_media_insights(a.ctx, { media_id: mediaId, account }));
}

async function authedPost(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ ctx: ToolCtx; json: Record<string, unknown> } | null> {
  const a = await authed(req, res);
  if (!a) return null;
  if ((req.method || "").toUpperCase() !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return null;
  }
  const { json } = await readBody(req);
  if (!json.account && typeof req.query.account === "string") {
    json.account = req.query.account;
  }
  return { ctx: a.ctx, json };
}

/**
 * Path segments under /api/rest. Parsed from req.url (not req.query.path):
 * the Vercel Node builder does not reliably populate query params for
 * catch-all routes, so the URL pathname is the source of truth.
 * Falls back to req.query.path for local tests / other runtimes.
 */
export function restSegs(req: VercelRequest): string[] {
  const fromQuery = (): string[] => {
    const raw = req.query.path;
    return raw === undefined ? [] : (Array.isArray(raw) ? raw : [raw]).map((s) => String(s));
  };
  try {
    const rawUrl = String((req as { url?: unknown }).url || "");
    if (!rawUrl) return fromQuery();
    const pathname = new URL(rawUrl, "http://localhost").pathname.replace(/\/+$/, "");
    const prefix = "/api/rest";
    if (pathname === prefix) return [];
    if (!pathname.startsWith(prefix + "/")) return fromQuery();
    return pathname
      .slice(prefix.length + 1)
      .split("/")
      .filter(Boolean)
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      });
  } catch {
    return fromQuery();
  }
}

export async function handleRest(req: VercelRequest, res: VercelResponse): Promise<void> {
  const segs = restSegs(req);
  const method = (req.method || "").toUpperCase();

  if (method === "GET" && (segs.length === 0 || (segs.length === 1 && (segs[0] === "account" || segs[0] === "me")))) {
    await handleAccount(req, res);
    return;
  }
  if (method === "GET" && segs.length === 1 && segs[0] === "media") {
    await handleMediaList(req, res);
    return;
  }
  if (method === "GET" && segs.length === 3 && segs[0] === "media" && segs[2] === "insights") {
    await handleMediaInsights(req, res, decodeURIComponent(segs[1]));
    return;
  }
  if (segs.length === 1 && segs[0] === "generate-image") {
    const p = await authedPost(req, res);
    if (!p) return;
    const parsed = S_ig_generate_image.safeParse(p.json);
    if (!parsed.success) {
      invalid(res, parsed.error.issues);
      return;
    }
    sendJson(res, 200, await ig_generate_image(p.ctx, parsed.data));
    return;
  }
  if (segs.length === 1 && segs[0] === "post") {
    const p = await authedPost(req, res);
    if (!p) return;
    const parsed = S_ig_post.safeParse(p.json);
    if (!parsed.success) {
      invalid(res, parsed.error.issues);
      return;
    }
    sendJson(res, 200, await ig_post(p.ctx, parsed.data));
    return;
  }
  if (segs.length === 1 && segs[0] === "generate-and-post") {
    const p = await authedPost(req, res);
    if (!p) return;
    const parsed = S_ig_generate_and_post.safeParse(p.json);
    if (!parsed.success) {
      invalid(res, parsed.error.issues);
      return;
    }
    sendJson(res, 200, await ig_generate_and_post(p.ctx, parsed.data));
    return;
  }
  sendJson(res, 404, { ok: false, error: "Unknown API route. See /api/openapi.json." });
}
