// REST routing: segments come from req.url (Vercel does not reliably
// populate req.query.path for catch-all routes). No network/KV needed:
// without a token, handlers fail with ok:false but routing is observable
// via status codes.

import { describe, expect, it, vi } from "vitest";
import { handleRest } from "../lib/rest-handler";
import { mintAccessToken } from "../lib/oauth";
import type { Cfg } from "../lib/env";

const JWT = "test-only-routing-secret-0123456789abcdef0123456789abcdef";

process.env.ADMIN_PASSWORD = "x";
process.env.IG_USER_ID = "1";
process.env.OAUTH_JWT_SECRET = JWT;

function mockRes() {
  const res: Record<string, unknown> & { statusCode?: number; payload?: unknown } = {};
  res.status = ((code: number) => { res.statusCode = code; return res; }) as never;
  res.json = ((body: unknown) => { res.payload = body; return res; }) as never;
  res.setHeader = (() => undefined) as never;
  res.redirect = (() => undefined) as never;
  return res as unknown as { statusCode: number; payload: unknown };
}

function mockReq(url: string, at?: string, query: Record<string, unknown> = {}) {
  return {
    method: "GET",
    url,
    query,
    headers: { host: "x.vercel.app", ...(at ? { authorization: `Bearer ${at}` } : {}) },
  } as never;
}

describe("rest routing from req.url", () => {
  it("/api/rest/media?limit=999 hits media branch (400), not account", async () => {
    const cfg = { adminPassword: "x", igUserId: "1", oauthJwtSecret: JWT } as Cfg;
    const at = await mintAccessToken(cfg, "https://x.vercel.app", ["ig:read", "ig:write"]);
    const res = mockRes();
    await handleRest(mockReq("/api/rest/media?limit=999", at, { limit: "999" }), res as never);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.payload)).toMatch(/<=50/);
  });

  it("/api/rest/media/123/insights reaches insights handler (token error, not account/404)", async () => {
    const cfg = { adminPassword: "x", igUserId: "1", oauthJwtSecret: JWT } as Cfg;
    const at = await mintAccessToken(cfg, "https://x.vercel.app", ["ig:read", "ig:write"]);
    const res = mockRes();
    await handleRest(mockReq("/api/rest/media/123/insights", at), res as never);
    expect(res.statusCode).toBe(200);
    const body = res.payload as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(String(body.error)).toMatch(/token/i);
  });

  it("unknown path returns 404 without auth", async () => {
    const res = mockRes();
    await handleRest(mockReq("/api/rest/nope"), res as never);
    expect(res.statusCode).toBe(404);
  });

  it("insights route handler rejects unauthenticated call with 401", async () => {
    const { default: insights } = await import("../api/rest/insights");
    const res = mockRes();
    await insights(
      { method: "GET", query: { media_id: "123" }, headers: { host: "x.vercel.app" } } as never,
      res as never,
    );
    expect(res.statusCode).toBe(401);
  });

  it("/api/rest/media passes account query param to ig_list_media", async () => {
    const tools = await import("../lib/tools");
    const spy = vi.spyOn(tools, "ig_list_media").mockResolvedValue({ ok: true, data: [] } as never);
    const cfg = { adminPassword: "x", igUserId: "1", oauthJwtSecret: JWT } as Cfg;
    const at = await mintAccessToken(cfg, "https://x.vercel.app", ["ig:read", "ig:write"]);
    const res = mockRes();

    await handleRest(
      {
        method: "GET",
        url: "/api/rest/media?account=17841469107971973",
        query: { account: "17841469107971973" },
        headers: { host: "x.vercel.app", authorization: `Bearer ${at}` },
      } as never,
      res as never,
    );

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ account: "17841469107971973" }),
    );
    spy.mockRestore();
  });

  it("/api/rest/insights passes account query param to ig_media_insights", async () => {
    const tools = await import("../lib/tools");
    const spy = vi.spyOn(tools, "ig_media_insights").mockResolvedValue({ ok: true } as never);
    const cfg = { adminPassword: "x", igUserId: "1", oauthJwtSecret: JWT } as Cfg;
    const at = await mintAccessToken(cfg, "https://x.vercel.app", ["ig:read", "ig:write"]);
    const res = mockRes();

    const { handleMediaInsights } = await import("../lib/rest-handler");
    await handleMediaInsights(
      {
        method: "GET",
        url: "/api/rest/insights?media_id=post_99&account=thesimplekrew",
        query: { media_id: "post_99", account: "thesimplekrew" },
        headers: { host: "x.vercel.app", authorization: `Bearer ${at}` },
      } as never,
      res as never,
      "post_99",
    );

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ media_id: "post_99", account: "thesimplekrew" }),
    );
    spy.mockRestore();
  });

  it("/api/rest/post falls back to query param account if omitted in json body", async () => {
    const tools = await import("../lib/tools");
    const spy = vi.spyOn(tools, "ig_post").mockResolvedValue({ ok: true, dry_run: true } as never);
    const cfg = { adminPassword: "x", igUserId: "1", oauthJwtSecret: JWT } as Cfg;
    const at = await mintAccessToken(cfg, "https://x.vercel.app", ["ig:read", "ig:write"]);
    const res = mockRes();

    await handleRest(
      {
        method: "POST",
        url: "/api/rest/post?account=print_.trek",
        query: { account: "print_.trek" },
        body: { image_url: "https://example.com/test.jpg" },
        headers: { host: "x.vercel.app", authorization: `Bearer ${at}`, "content-type": "application/json" },
      } as never,
      res as never,
    );

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ account: "print_.trek", image_url: "https://example.com/test.jpg" }),
    );
    spy.mockRestore();
  });
});

