// Tiny shared helpers.

import type { ToolResult } from "./tools";

export function textResult(result: ToolResult) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

export function json(data: unknown, status = 200, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

export function html(body: string, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...extraHeaders },
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Constant-time string comparison (admin password check). */
export async function verifyPassword(provided: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  const ha = await crypto.subtle.digest("SHA-256", a);
  const hb = await crypto.subtle.digest("SHA-256", b);
  const xa = new Uint8Array(ha);
  const xb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ xb[i];
  return diff === 0;
}

/** CORS: Bearer-token API with no cookies — reflect-safe permissive policy. */
export function withCors(res: Response, req: Request): Response {
  const headers = new Headers(res.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  );
  headers.set("access-control-expose-headers", "mcp-protocol-version, mcp-session-id");
  headers.set("access-control-max-age", "86400");
  void req;
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers":
        "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
      "access-control-max-age": "86400",
    },
  });
}
