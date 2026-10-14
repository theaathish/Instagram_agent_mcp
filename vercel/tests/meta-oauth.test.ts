import { describe, it, expect, vi } from "vitest";
import {
  buildMetaAuthUrl,
  exchangeCodeForToken,
  discoverInstagramAccounts,
} from "../lib/meta-oauth";
import { signJwt } from "../lib/jwt";
import type { Cfg } from "../lib/env";

const mockCfg: Cfg = {
  adminPassword: "test-admin-pwd",
  igUserId: "default",
  oauthJwtSecret: "test-secret-at-least-32-chars-long-123456",
  apiVersion: "v22.0",
  graphBase: "https://graph.instagram.com",
  metaAppId: "1619333802967440",
  metaAppSecret: "968b7183f72613624df93259afb86d7d",
  firebaseDatabaseUrl: "https://mock-db.firebaseio.com",
};

describe("Meta OAuth Flow", () => {
  it("buildMetaAuthUrl creates a valid Meta authorization URL", () => {
    const urlStr = buildMetaAuthUrl(mockCfg, "https://example.com", "state-123");
    const parsed = new URL(urlStr);

    expect(parsed.origin).toBe("https://www.facebook.com");
    expect(parsed.pathname).toBe("/v22.0/dialog/oauth");
    expect(parsed.searchParams.get("client_id")).toBe("1619333802967440");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.com/api/admin/oauth/callback");
    expect(parsed.searchParams.get("state")).toBe("state-123");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toContain("instagram_basic");
  });

  it("buildMetaAuthUrl throws if metaAppId is not configured", () => {
    expect(() => buildMetaAuthUrl({ ...mockCfg, metaAppId: undefined }, "https://example.com", "state-123")).toThrow(
      "META_APP_ID",
    );
  });

  it("exchangeCodeForToken trades code for short-lived and long-lived token", async () => {
    const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("grant_type=fb_exchange_token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "long-lived-token-60d", expires_in: 5184000 }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ access_token: "short-lived-token", expires_in: 3600 }),
      } as Response;
    });

    const res = await exchangeCodeForToken(mockCfg, "https://example.com", "valid-code", fakeFetch);
    expect(res.access_token).toBe("long-lived-token-60d");
    expect(res.expires_in).toBe(5184000);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("discoverInstagramAccounts extracts connected Instagram accounts from Facebook Pages", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "page-123",
            name: "My Brand Page",
            access_token: "page-access-token-permanent",
            instagram_business_account: {
              id: "1784140011223344",
              username: "coolbrand",
              name: "Cool Brand Official",
              account_type: "BUSINESS",
            },
          },
        ],
      }),
    } as Response);

    const accounts = await discoverInstagramAccounts("user-token", fakeFetch);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].ig_user_id).toBe("1784140011223344");
    expect(accounts[0].username).toBe("coolbrand");
    expect(accounts[0].token).toBe("page-access-token-permanent");
    expect(accounts[0].account_type).toBe("BUSINESS");
  });

  it("discoverInstagramAccounts falls back to /me if no pages have IG business account", async () => {
    const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/me/accounts")) {
        return {
          ok: true,
          json: async () => ({ data: [] }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          id: "17841499999",
          username: "direct_ig_user",
          account_type: "MEDIA_CREATOR",
        }),
      } as Response;
    });

    const accounts = await discoverInstagramAccounts("direct-token", fakeFetch);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].ig_user_id).toBe("17841499999");
    expect(accounts[0].username).toBe("direct_ig_user");
    expect(accounts[0].token).toBe("direct-token");
  });
});
