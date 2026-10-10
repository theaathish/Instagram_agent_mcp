// Local smoke test for api routes (mock req/res). Catches wiring errors
// before deploy.

import { describe, expect, it } from "vitest";
import wellknown from "../api/wellknown/[doc]";
import openapi from "../api/openapi";
import oauthAction from "../api/oauth/[action]";

function mockReq(method = "GET", query: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return { method, query, headers, body: undefined } as never;
}

function mockRes() {
  const res: Record<string, unknown> & {
    statusCode?: number;
    payload?: unknown;
    headers: Record<string, string>;
  } = { headers: {} };
  res.status = ((code: number) => {
    res.statusCode = code;
    return res;
  }) as never;
  res.json = ((body: unknown) => {
    res.payload = body;
    return res;
  }) as never;
  res.setHeader = ((k: string, v: string) => {
    res.headers[k] = v;
  }) as never;
  return res as never;
}

describe("api smoke", () => {
  it("wellknown resource returns metadata", async () => {
    const req = mockReq("GET", { doc: "resource" }, { host: "x.vercel.app" });
    const res = mockRes() as unknown as { statusCode: number; payload: Record<string, unknown> };
    await wellknown(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(res.payload.resource).toBe("https://x.vercel.app/mcp");
  });

  it("openapi returns a doc", async () => {
    const req = mockReq("GET", {}, { host: "x.vercel.app" });
    const res = mockRes() as unknown as { statusCode: number; payload: Record<string, unknown> };
    await openapi(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(res.payload.openapi).toBe("3.1.0");
  });

  it("register without KV returns clean 500 JSON (never throws)", async () => {
    const req = {
      method: "POST",
      query: { action: "register" },
      headers: { host: "x.vercel.app", "content-type": "application/json" },
      body: { redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "t" },
    } as never;
    const res = mockRes() as unknown as { statusCode: number; payload: Record<string, unknown> };
    await oauthAction(req, res as never);
    expect(res.statusCode).toBe(500);
    expect(String((res.payload as { error: string }).error)).toMatch(/KV is not configured/);
  });
});
