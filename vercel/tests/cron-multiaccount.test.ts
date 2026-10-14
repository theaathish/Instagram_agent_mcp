import { describe, expect, it } from "vitest";
import handler from "../api/cron/refresh";
import type { VercelRequest, VercelResponse } from "@vercel/node";

function mockReqRes(headers: Record<string, string> = {}) {
  let statusCode = 200;
  let responseData: any = null;

  const req = {
    method: "GET",
    headers,
  } as unknown as VercelRequest;

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      responseData = data;
      return res;
    },
  } as unknown as VercelResponse;

  return { req, res, getStatus: () => statusCode, getData: () => responseData };
}

describe("Multi-account Cron Refresh", () => {
  it("rejects without valid CRON_SECRET", async () => {
    process.env.ADMIN_PASSWORD = "secret_password";
    process.env.OAUTH_JWT_SECRET = "012345678901234567890123456789012345";
    process.env.CRON_SECRET = "my_cron_secret";

    const { req, res, getStatus } = mockReqRes({ authorization: "Bearer wrong" });
    await handler(req, res);
    expect(getStatus()).toBe(401);
  });

  it("iterates and refreshes candidate accounts under multi-account mode", async () => {
    process.env.ADMIN_PASSWORD = "secret_password";
    process.env.OAUTH_JWT_SECRET = "012345678901234567890123456789012345";
    process.env.CRON_SECRET = "my_cron_secret";

    // Setup mock RTDB with 2 accounts:
    // Account 1: expires in 5 days (needs refresh)
    // Account 2: expires in 55 days (does not need refresh)
    const nowSec = Math.floor(Date.now() / 1000);
    const mockDb: Record<string, any> = {
      accounts: {
        "100": {
          ig_user_id: "100",
          username: "needs_refresh",
          access_token: "token_old",
          token_expires_at: nowSec + 5 * 86400,
        },
        "200": {
          ig_user_id: "200",
          username: "fresh_account",
          access_token: "token_fresh",
          token_expires_at: nowSec + 55 * 86400,
        },
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method || "GET";

      if (urlStr.includes("refresh_access_token")) {
        return new Response(JSON.stringify({ access_token: "token_renewed", expires_in: 5184000 }), {
          status: 200,
        });
      }
      if (urlStr.endsWith("/accounts.json") && method === "GET") {
        return new Response(JSON.stringify(mockDb.accounts), { status: 200 });
      }
      if (urlStr.includes("/accounts/100") && method === "PUT") {
        const body = JSON.parse(init?.body as string);
        mockDb.accounts["100"] = body;
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    try {
      const { req, res, getStatus, getData } = mockReqRes({ authorization: "Bearer my_cron_secret" });
      await handler(req, res);

      expect(getStatus()).toBe(200);
      expect(getData().ok).toBe(true);
      expect(getData().refreshed_count).toBe(1);
      expect(mockDb.accounts["100"].access_token).toBe("token_renewed");
      expect(mockDb.accounts["200"].access_token).toBe("token_fresh");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
