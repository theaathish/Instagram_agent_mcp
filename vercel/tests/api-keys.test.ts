import { describe, expect, it, vi } from "vitest";
import { createFirebaseStore, type ApiKeyRecord } from "../lib/firebase";
import { guardAuth } from "../lib/http";
import type { Cfg } from "../lib/env";
import type { VercelRequest, VercelResponse } from "@vercel/node";

process.env.ADMIN_PASSWORD = "secret_admin_pw";
process.env.OAUTH_JWT_SECRET = "test-jwt-secret-012345678901234567890123456789";
process.env.FIREBASE_DATABASE_URL = "https://mock-rtdb.firebaseio.com";

const CFG: Cfg = {
  adminPassword: "secret_admin_pw",
  igUserId: "default",
  oauthJwtSecret: "test-jwt-secret-012345678901234567890123456789",
  apiVersion: "v26.0",
  graphBase: "https://graph.instagram.com",
};

function mockReqRes(headers: Record<string, string> = {}, query: Record<string, unknown> = {}) {
  let statusCode = 200;
  let responseData: unknown = null;
  const sentHeaders: Record<string, string> = {};

  const req = {
    method: "GET",
    headers,
    query,
  } as unknown as VercelRequest;

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      responseData = data;
      return res;
    },
    setHeader(name: string, val: string) {
      sentHeaders[name] = val;
      return res;
    },
    writeHead(code: number, hdrs: Record<string, string>) {
      statusCode = code;
      Object.assign(sentHeaders, hdrs);
      return res;
    },
    end() {
      return res;
    },
  } as unknown as VercelResponse;

  return { req, res, getStatus: () => statusCode, getData: () => responseData };
}

describe("API Key Management & Scoped Auth", () => {
  it("createApiKey generates a valid ig_live_ key and stores it in Firebase", async () => {
    const memoryDb: Record<string, ApiKeyRecord> = {};

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method || "GET";

      if (urlStr.includes("/api_keys") && method === "GET") {
        return new Response(JSON.stringify(memoryDb), { status: 200 });
      }
      if (urlStr.includes("/api_keys/") && method === "PUT") {
        const body = JSON.parse(init?.body as string);
        const id = urlStr.split("/api_keys/")[1].replace(".json", "");
        memoryDb[id] = body;
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const store = createFirebaseStore("https://mock-rtdb.firebaseio.com", mockFetch);
    const keyRec = await store.createApiKey("CRM Integration", "thesimplekrew");

    expect(keyRec.key).toMatch(/^ig_live_[a-zA-Z0-9_-]{24,}$/);
    expect(keyRec.name).toBe("CRM Integration");
    expect(keyRec.account).toBe("thesimplekrew");
    expect(keyRec.status).toBe("active");

    const found = await store.getApiKey(keyRec.key);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(keyRec.id);
  });

  it("guardAuth authenticates with ig_live_ key and attaches scopedAccount", async () => {
    const mockDb: Record<string, ApiKeyRecord> = {
      key_1: {
        id: "key_1",
        key: "ig_live_testkey1234567890123456",
        name: "Test CRM",
        account: "thesimplekrew",
        created_at: Math.floor(Date.now() / 1000),
        status: "active",
      },
    };

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/api_keys")) {
        return new Response(JSON.stringify(mockDb), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const customCfg = { ...CFG, firebaseDatabaseUrl: "https://mock-rtdb.firebaseio.com" };
    const { req, res, getStatus } = mockReqRes({ authorization: "Bearer ig_live_testkey1234567890123456" });

    // Mock global fetch for guardAuth
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const auth = await guardAuth(req, res, customCfg, "https://mock.vercel.app");
      expect(auth).not.toBeNull();
      expect(auth?.scope).toContain("ig:read");
      expect(auth?.scope).toContain("ig:write");
      expect((auth as unknown as { scopedAccount?: string })?.scopedAccount).toBe("thesimplekrew");
      expect(getStatus()).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("guardAuth rejects revoked or nonexistent ig_live_ key", async () => {
    const mockDb: Record<string, ApiKeyRecord> = {
      key_revoked: {
        id: "key_revoked",
        key: "ig_live_revokedkey1234567890",
        name: "Old CRM",
        account: "thesimplekrew",
        created_at: 100,
        status: "revoked",
      },
    };

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/api_keys")) {
        return new Response(JSON.stringify(mockDb), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const customCfg = { ...CFG, firebaseDatabaseUrl: "https://mock-rtdb.firebaseio.com" };
    const { req, res, getStatus } = mockReqRes({ authorization: "Bearer ig_live_revokedkey1234567890" });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const auth = await guardAuth(req, res, customCfg, "https://mock.vercel.app");
      expect(auth).toBeNull();
      expect(getStatus()).toBe(401);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("enforces account scoping when an account-scoped API key tries to access another account", async () => {
    const mockDb: Record<string, ApiKeyRecord> = {
      key_1: {
        id: "key_1",
        key: "ig_live_scoped_to_simplekrew",
        name: "Test CRM",
        account: "thesimplekrew",
        created_at: Math.floor(Date.now() / 1000),
        status: "active",
      },
    };

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/api_keys")) {
        return new Response(JSON.stringify(mockDb), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const { handleRest } = await import("../lib/rest-handler");
      const { req, res, getStatus, getData } = mockReqRes(
        { authorization: "Bearer ig_live_scoped_to_simplekrew", host: "mock.vercel.app" },
        { account: "strucureo" },
      );
      (req as unknown as { url: string }).url = "/api/rest/account?account=strucureo";

      await handleRest(req, res);
      expect(getStatus()).toBe(403);
      expect((getData() as { error: string }).error).toMatch(/restricted to account @thesimplekrew/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("api/admin/keys handler supports GET, POST, and DELETE", async () => {
    const { default: keysHandler } = await import("../api/admin/keys");
    const memoryDb: Record<string, ApiKeyRecord> = {};

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method || "GET";

      if (urlStr.includes("/api_keys/") && method === "PUT") {
        const body = JSON.parse(init?.body as string);
        const id = urlStr.split("/api_keys/")[1].replace(".json", "");
        memoryDb[id] = body;
        return new Response(JSON.stringify(body), { status: 200 });
      }
      if (urlStr.includes("/api_keys/") && method === "PATCH") {
        const body = JSON.parse(init?.body as string);
        const id = urlStr.split("/api_keys/")[1].replace(".json", "");
        if (memoryDb[id]) Object.assign(memoryDb[id], body);
        return new Response(JSON.stringify(memoryDb[id] || {}), { status: 200 });
      }
      if (urlStr.includes("/api_keys/") && method === "GET") {
        const id = urlStr.split("/api_keys/")[1].replace(".json", "");
        return new Response(JSON.stringify(memoryDb[id] || null), { status: 200 });
      }
      if (urlStr.includes("/api_keys") && method === "GET") {
        return new Response(JSON.stringify(memoryDb), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      // 1. Unauthorized GET
      const { req: unauthReq, res: unauthRes, getStatus: getUnauthStatus } = mockReqRes();
      await keysHandler(unauthReq, unauthRes);
      expect(getUnauthStatus()).toBe(401);

      // 2. Authorized POST -> Create key
      const { req: postReq, res: postRes, getStatus: getPostStatus, getData: getPostData } = mockReqRes(
        { "x-admin-password": "secret_admin_pw", "content-type": "application/json" },
      );
      (postReq as unknown as { method: string; body: unknown }).method = "POST";
      (postReq as unknown as { body: unknown }).body = { name: "CRM Bot", account: "thesimplekrew" };

      await keysHandler(postReq, postRes);
      expect(getPostStatus()).toBe(201);
      const created = (getPostData() as { key_record: ApiKeyRecord }).key_record;
      expect(created.key).toMatch(/^ig_live_/);
      expect(created.name).toBe("CRM Bot");
      expect(created.account).toBe("thesimplekrew");

      // 3. Authorized GET -> List keys (masked)
      const { req: listReq, res: listRes, getStatus: getListStatus, getData: getListData } = mockReqRes(
        { "x-admin-password": "secret_admin_pw" },
      );
      await keysHandler(listReq, listRes);
      expect(getListStatus()).toBe(200);
      const list = (getListData() as { keys: Array<{ id: string; masked_key: string }> }).keys;
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(created.id);
      expect(list[0].masked_key).toContain("...");

      // 4. Authorized DELETE -> Revoke key
      const { req: delReq, res: delRes, getStatus: getDelStatus } = mockReqRes(
        { "x-admin-password": "secret_admin_pw" },
        { id: created.id },
      );
      (delReq as unknown as { method: string }).method = "DELETE";

      await keysHandler(delReq, delRes);
      expect(getDelStatus()).toBe(200);
      expect(memoryDb[created.id].status).toBe("revoked");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

