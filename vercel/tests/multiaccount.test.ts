import { describe, expect, it } from "vitest";
import { type AccountStore, type AccountRecord } from "../lib/firebase";
import {
  ig_me,
  ig_post,
  ig_list_accounts,
  ig_set_active_account,
  type ToolCtx,
} from "../lib/tools";
import type { Cfg } from "../lib/env";
import { memoryStore } from "../lib/store";

function makeMockAccountStore(initialAccounts: AccountRecord[] = []): AccountStore {
  const accounts: Record<string, AccountRecord> = {};
  for (const a of initialAccounts) accounts[a.ig_user_id] = { ...a };
  let activeId = initialAccounts.find((a) => a.is_default)?.ig_user_id || initialAccounts[0]?.ig_user_id;

  return {
    async listAccounts() {
      return Object.values(accounts);
    },
    async getAccount(idOrUsername: string) {
      const clean = idOrUsername.replace(/^@/, "").toLowerCase();
      return (
        Object.values(accounts).find(
          (a) => a.ig_user_id === clean || a.username.toLowerCase() === clean,
        ) || null
      );
    },
    async getDefaultAccount() {
      if (activeId && accounts[activeId]) return accounts[activeId];
      return Object.values(accounts)[0] || null;
    },
    async saveAccount(account: AccountRecord) {
      accounts[account.ig_user_id] = account;
    },
    async updateAccount(id: string, updates: Partial<AccountRecord>) {
      const match = await this.getAccount(id);
      if (!match) return false;
      Object.assign(accounts[match.ig_user_id], updates);
      return true;
    },
    async deleteAccount(id: string) {
      delete accounts[id];
      return true;
    },
    async setDefaultAccount(id: string) {
      const match = await this.getAccount(id);
      if (!match) return false;
      activeId = match.ig_user_id;
      for (const a of Object.values(accounts)) {
        a.is_default = a.ig_user_id === activeId;
      }
      return true;
    },
    async incrementPublishCount(id: string) {
      const acc = accounts[id];
      if (!acc) throw new Error("not found");
      const current = acc.publish_budget?.count_24h || 0;
      acc.publish_budget = { count_24h: current + 1, window_start: Date.now() / 1000 };
      return acc.publish_budget.count_24h;
    },
  };
}

describe("Multi-account MCP Tools", () => {
  const cfg: Cfg = {
    adminPassword: "test",
    igUserId: "default_user",
    oauthJwtSecret: "test-secret-at-least-32-chars-long",
    apiVersion: "v26.0",
    graphBase: "https://graph.instagram.com",
  };

  const account1: AccountRecord = {
    ig_user_id: "1001",
    username: "brand_one",
    account_type: "BUSINESS",
    access_token: "token_1",
    token_expires_at: 1900000000,
    is_default: true,
  };

  const account2: AccountRecord = {
    ig_user_id: "2002",
    username: "brand_two",
    account_type: "CREATOR",
    access_token: "token_2",
    token_expires_at: 1900000000,
    is_default: false,
  };

  it("ig_list_accounts lists all connected accounts without leaking tokens", async () => {
    const accountStore = makeMockAccountStore([account1, account2]);
    const ctx: ToolCtx = {
      deps: { cfg, store: memoryStore(), accountStore },
      origin: "https://example.com",
    };

    const res = await ig_list_accounts(ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const list = res["accounts"] as any[];
      expect(list).toHaveLength(2);
      expect(list[0].username).toBe("brand_one");
      expect(list[0].access_token).toBeUndefined();
      expect(list[1].username).toBe("brand_two");
      expect(list[1].access_token).toBeUndefined();
    }
  });

  it("ig_set_active_account switches default active account", async () => {
    const accountStore = makeMockAccountStore([account1, account2]);
    const ctx: ToolCtx = {
      deps: { cfg, store: memoryStore(), accountStore },
      origin: "https://example.com",
    };

    const res = await ig_set_active_account(ctx, { account: "brand_two" });
    expect(res.ok).toBe(true);
    const def = await accountStore.getDefaultAccount();
    expect(def?.username).toBe("brand_two");
  });

  it("resolves specific account in ig_me via mock graphCall", async () => {
    const accountStore = makeMockAccountStore([account1, account2]);
    let calledToken = "";
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes("access_token=token_2")) {
        calledToken = "token_2";
      } else if (urlStr.includes("access_token=token_1")) {
        calledToken = "token_1";
      }
      return new Response(JSON.stringify({ id: "2002", username: "brand_two", account_type: "CREATOR" }), {
        status: 200,
      });
    };

    const ctx: ToolCtx = {
      deps: { cfg, store: memoryStore(), accountStore, fetchFn: mockFetch as typeof fetch },
      origin: "https://example.com",
    };

    const res = await ig_me(ctx, { account: "brand_two" });
    expect(res.ok).toBe(true);
    expect(calledToken).toBe("token_2");
  });

  it("fails fast if queried account does not exist", async () => {
    const accountStore = makeMockAccountStore([account1]);
    const ctx: ToolCtx = {
      deps: { cfg, store: memoryStore(), accountStore },
      origin: "https://example.com",
    };

    const res = await ig_post(ctx, { image_url: "https://example.com/pic.jpg", account: "non_existent", dry_run: false });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/account.*not found/i);
    }
  });
});
