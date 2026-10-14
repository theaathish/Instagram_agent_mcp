import { describe, expect, it } from "vitest";
import { createFirebaseStore, type AccountRecord } from "../lib/firebase";

describe("Firebase AccountStore", () => {
  it("listAccounts returns empty array when no accounts exist", async () => {
    const mockDb: Record<string, unknown> = {};
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.endsWith("/accounts.json") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify(mockDb["accounts"] ?? null), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const store = createFirebaseStore("https://mock-db.firebaseio.com", mockFetch as typeof fetch);
    const accounts = await store.listAccounts();
    expect(accounts).toEqual([]);
  });

  it("saveAccount and getAccount by ID and username", async () => {
    const mockDb: Record<string, any> = { accounts: {}, settings: {} };
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = String(url);
      const method = init?.method || "GET";

      if (urlStr.includes("/accounts/")) {
        const match = urlStr.match(/\/accounts\/([^.]+)\.json/);
        const id = match ? match[1] : "";
        if (method === "PUT") {
          const body = JSON.parse(init?.body as string);
          mockDb.accounts[id] = body;
          return new Response(JSON.stringify(body), { status: 200 });
        }
        if (method === "GET") {
          return new Response(JSON.stringify(mockDb.accounts[id] ?? null), { status: 200 });
        }
      }
      if (urlStr.endsWith("/accounts.json") && method === "GET") {
        return new Response(JSON.stringify(mockDb.accounts), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const store = createFirebaseStore("https://mock-db.firebaseio.com", mockFetch as typeof fetch);
    const account: AccountRecord = {
      ig_user_id: "12345",
      username: "cool_brand",
      account_type: "BUSINESS",
      access_token: "token_abc",
      token_expires_at: 1800000000,
      granted_scopes: ["instagram_business_basic", "instagram_business_content_publish"],
      is_default: true,
      status: "active",
    };

    await store.saveAccount(account);

    const byId = await store.getAccount("12345");
    expect(byId).not.toBeNull();
    expect(byId?.username).toBe("cool_brand");

    const byUsername = await store.getAccount("cool_brand");
    expect(byUsername).not.toBeNull();
    expect(byUsername?.ig_user_id).toBe("12345");

    const missing = await store.getAccount("non_existent");
    expect(missing).toBeNull();
  });

  it("getDefaultAccount returns explicit default or first available", async () => {
    const mockDb: Record<string, any> = {
      accounts: {
        "100": { ig_user_id: "100", username: "brand1", is_default: false },
        "200": { ig_user_id: "200", username: "brand2", is_default: true },
      },
      settings: { active_account_id: "200" },
    };
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.endsWith("/settings.json")) {
        return new Response(JSON.stringify(mockDb.settings), { status: 200 });
      }
      if (urlStr.includes("/accounts/200.json")) {
        return new Response(JSON.stringify(mockDb.accounts["200"]), { status: 200 });
      }
      if (urlStr.endsWith("/accounts.json")) {
        return new Response(JSON.stringify(mockDb.accounts), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const store = createFirebaseStore("https://mock-db.firebaseio.com", mockFetch as typeof fetch);
    const def = await store.getDefaultAccount();
    expect(def?.ig_user_id).toBe("200");
  });

  it("setDefaultAccount updates settings and account flags", async () => {
    const mockDb: Record<string, any> = {
      accounts: {
        "100": { ig_user_id: "100", username: "brand1", is_default: true },
        "200": { ig_user_id: "200", username: "brand2", is_default: false },
      },
      settings: { active_account_id: "100" },
    };

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = String(url);
      const method = init?.method || "GET";
      if (urlStr.endsWith("/settings.json") && method === "PUT") {
        mockDb.settings = JSON.parse(init?.body as string);
        return new Response(JSON.stringify(mockDb.settings), { status: 200 });
      }
      if (urlStr.endsWith("/settings.json") && method === "GET") {
        return new Response(JSON.stringify(mockDb.settings), { status: 200 });
      }
      if (urlStr.endsWith("/accounts.json") && method === "GET") {
        return new Response(JSON.stringify(mockDb.accounts), { status: 200 });
      }
      if (urlStr.includes("/accounts/")) {
        const match = urlStr.match(/\/accounts\/([^.]+)\.json/);
        const id = match ? match[1] : "";
        if (method === "PATCH") {
          const patch = JSON.parse(init?.body as string);
          Object.assign(mockDb.accounts[id], patch);
          return new Response(JSON.stringify(mockDb.accounts[id]), { status: 200 });
        }
        if (method === "GET") {
          return new Response(JSON.stringify(mockDb.accounts[id]), { status: 200 });
        }
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const store = createFirebaseStore("https://mock-db.firebaseio.com", mockFetch as typeof fetch);
    const ok = await store.setDefaultAccount("200");
    expect(ok).toBe(true);
    expect(mockDb.settings.active_account_id).toBe("200");
    expect(mockDb.accounts["200"].is_default).toBe(true);
    expect(mockDb.accounts["100"].is_default).toBe(false);
  });

  it("deleteAccount removes the account from store", async () => {
    const mockDb: Record<string, any> = {
      accounts: {
        "100": { ig_user_id: "100", username: "brand1" },
      },
    };
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = String(url);
      const method = init?.method || "GET";
      if (urlStr.includes("/accounts/100.json") && method === "DELETE") {
        delete mockDb.accounts["100"];
        return new Response(JSON.stringify(null), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const store = createFirebaseStore("https://mock-db.firebaseio.com", mockFetch as typeof fetch);
    const ok = await store.deleteAccount("100");
    expect(ok).toBe(true);
    expect(mockDb.accounts["100"]).toBeUndefined();
  });

  it("incrementPublishCount increments rolling budget and resets after 24h", async () => {
    const nowSec = 1700000000;
    const mockDb: Record<string, any> = {
      accounts: {
        "100": {
          ig_user_id: "100",
          publish_budget: { count_24h: 3, window_start: nowSec - 100 },
        },
      },
    };

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = String(url);
      const method = init?.method || "GET";
      if (urlStr.includes("/accounts/100.json") && method === "GET") {
        return new Response(JSON.stringify(mockDb.accounts["100"]), { status: 200 });
      }
      if (urlStr.includes("/accounts/100/publish_budget.json") && method === "PUT") {
        const body = JSON.parse(init?.body as string);
        mockDb.accounts["100"].publish_budget = body;
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const store = createFirebaseStore("https://mock-db.firebaseio.com", mockFetch as typeof fetch);
    const count = await store.incrementPublishCount("100", nowSec);
    expect(count).toBe(4);

    // After 25 hours (window reset)
    const resetCount = await store.incrementPublishCount("100", nowSec + 90000);
    expect(resetCount).toBe(1);
  });
});
