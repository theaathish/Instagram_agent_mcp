import { describe, expect, it } from "vitest";
import handler from "../api/admin/accounts";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { AccountStore, AccountRecord } from "../lib/firebase";

function makeMockAccountStore(): AccountStore & { accounts: Record<string, AccountRecord> } {
  const accounts: Record<string, AccountRecord> = {};
  let activeId: string | undefined;

  return {
    accounts,
    async listAccounts() {
      return Object.values(accounts);
    },
    async getAccount(idOrUsername: string) {
      return (
        Object.values(accounts).find(
          (a) => a.ig_user_id === idOrUsername || a.username === idOrUsername,
        ) || null
      );
    },
    async getDefaultAccount() {
      return (activeId && accounts[activeId]) || Object.values(accounts)[0] || null;
    },
    async saveAccount(account: AccountRecord) {
      accounts[account.ig_user_id] = account;
    },
    async updateAccount(id: string, updates: Partial<AccountRecord>) {
      const acc = accounts[id];
      if (!acc) return false;
      Object.assign(acc, updates);
      return true;
    },
    async deleteAccount(id: string) {
      delete accounts[id];
      return true;
    },
    async setDefaultAccount(id: string) {
      activeId = id;
      for (const a of Object.values(accounts)) {
        a.is_default = a.ig_user_id === id;
      }
      return true;
    },
    async incrementPublishCount(id: string) {
      return 1;
    },
  };
}

function mockReqRes(method: string, headers: Record<string, string> = {}, body: any = {}, query: Record<string, any> = {}) {
  let statusCode = 200;
  let responseData: any = null;
  const resHeaders: Record<string, string> = {};

  const req = {
    method,
    headers,
    body,
    query,
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
    setHeader(name: string, value: string) {
      resHeaders[name] = value;
      return res;
    },
    end() {
      return res;
    },
  } as unknown as VercelResponse;

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
  };
}

describe("Admin Accounts API", () => {
  it("rejects unauthorized requests", async () => {
    process.env.ADMIN_PASSWORD = "secret_password";
    process.env.OAUTH_JWT_SECRET = "012345678901234567890123456789012345";
    const { req, res, getStatus, getData } = mockReqRes("GET");

    await handler(req, res);
    expect(getStatus()).toBe(401);
    expect(getData().ok).toBe(false);
  });

  it("lists accounts when authorized with admin password", async () => {
    process.env.ADMIN_PASSWORD = "secret_password";
    process.env.OAUTH_JWT_SECRET = "012345678901234567890123456789012345";
    const { req, res, getStatus, getData } = mockReqRes("GET", {
      "x-admin-password": "secret_password",
    });

    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(getData().ok).toBe(true);
    expect(Array.isArray(getData().accounts)).toBe(true);
  });

  it("adds and verifies an account with a token", async () => {
    process.env.ADMIN_PASSWORD = "secret_password";
    process.env.OAUTH_JWT_SECRET = "012345678901234567890123456789012345";

    // Mock fetch for Meta's /me endpoint
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("graph.instagram.com") && urlStr.includes("/me")) {
        return new Response(JSON.stringify({ id: "987654", username: "new_brand", account_type: "BUSINESS" }), {
          status: 200,
        });
      }
      return originalFetch(url);
    }) as typeof fetch;

    try {
      const { req, res, getStatus, getData } = mockReqRes(
        "POST",
        { "x-admin-password": "secret_password" },
        { token: "mock_meta_token", brand_style: "vibrant" },
      );

      await handler(req, res);
      expect(getStatus()).toBe(200);
      expect(getData().ok).toBe(true);
      expect(getData().account.username).toBe("new_brand");
      expect(getData().account.ig_user_id).toBe("987654");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("deletes an account", async () => {
    process.env.ADMIN_PASSWORD = "secret_password";
    process.env.OAUTH_JWT_SECRET = "012345678901234567890123456789012345";

    const { req, res, getStatus, getData } = mockReqRes(
      "DELETE",
      { "x-admin-password": "secret_password" },
      {},
      { id: "987654" },
    );

    await handler(req, res);
    expect(getStatus()).toBe(200);
    expect(getData().ok).toBe(true);
  });
});
