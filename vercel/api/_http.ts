// Shared HTTP plumbing for the api/ functions.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadCfg, originOf, type Cfg } from "../lib/env";
import { kvStore, type Store } from "../lib/store";
import { bearerToken, checkAccessToken, unauthorizedChallenge } from "../lib/oauth";

export function reqOrigin(req: VercelRequest): string {
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "localhost:3000";
  const proto = ((req.headers["x-forwarded-proto"] as string) || "https").split(",")[0];
  return originOf(host, proto);
}

export function cors(res: VercelResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  );
  res.setHeader("access-control-expose-headers", "mcp-protocol-version, mcp-session-id");
  res.setHeader("access-control-max-age", "86400");
}

export function maybeOptions(req: VercelRequest, res: VercelResponse): boolean {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export function sendJson(res: VercelResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.status(status).json(body);
}

export function sendHtml(res: VercelResponse, status: number, body: string): void {
  res.status(status).setHeader("content-type", "text/html; charset=utf-8").send(body);
}

/** Load config, or answer 500 when required env vars are missing. */
export function needCfg(res: VercelResponse): Cfg | null {
  try {
    return loadCfg();
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export function store(): Store {
  return kvStore;
}

/** OAuth guard for /api/mcp and /api/rest/*. 401-challenges on failure. */
export async function guardAuth(
  req: VercelRequest,
  res: VercelResponse,
  cfg: Cfg,
  origin: string,
): Promise<{ scope: string[] } | null> {
  const token = bearerToken({ headers: req.headers as Record<string, unknown> });
  if (!token) {
    const c = unauthorizedChallenge(origin);
    sendJson(res, c.status, c.body, c.headers);
    return null;
  }
  const ok = await checkAccessToken(cfg, origin, token);
  if (!ok) {
    const c = unauthorizedChallenge(origin);
    sendJson(res, c.status, { ok: false, error: "Invalid or expired access token." }, c.headers);
    return null;
  }
  return ok;
}

/** Read the request body regardless of content-type (JSON or urlencoded). */
export async function readBody(req: VercelRequest): Promise<{ json: Record<string, unknown>; form: URLSearchParams }> {
  const ct = String(req.headers["content-type"] || "");
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return { json: req.body as Record<string, unknown>, form: new URLSearchParams() };
  }
  let raw: Buffer;
  if (typeof req.body === "string") raw = Buffer.from(req.body);
  else if (Buffer.isBuffer(req.body)) raw = req.body;
  else {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    raw = Buffer.concat(chunks);
  }
  if (ct.includes("application/json")) {
    try {
      return { json: (JSON.parse(raw.toString("utf8") || "{}") ?? {}) as Record<string, unknown>, form: new URLSearchParams() };
    } catch {
      return { json: {}, form: new URLSearchParams() };
    }
  }
  return { json: {}, form: new URLSearchParams(raw.toString("utf8")) };
}

export const noBodyParse = { api: { bodyParser: false as const } };
