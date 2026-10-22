// Firebase Realtime Database Account Store
// Handles multi-account persistence, token storage, and per-account publish budgets.

export interface AccountRecord {
  ig_user_id: string;
  username: string;
  account_type: string;
  access_token: string;
  token_expires_at?: number;
  granted_scopes?: string[];
  is_default?: boolean;
  brand_style?: string;
  profile_picture_url?: string;
  publish_budget?: { count_24h: number; window_start: number };
  custom_publish_cap?: number;
  connected_at?: number;
  last_refreshed_at?: number;
  status?: "active" | "paused" | "expired" | "revoked";
}

export interface ApiKeyRecord {
  id: string;
  key: string;
  name: string;
  account?: string;
  created_at: number;
  last_used_at?: number;
  status: "active" | "revoked";
}

export interface AccountStore {
  listAccounts(): Promise<AccountRecord[]>;
  getAccount(idOrUsername: string): Promise<AccountRecord | null>;
  getDefaultAccount(): Promise<AccountRecord | null>;
  saveAccount(account: AccountRecord): Promise<void>;
  updateAccount(ig_user_id: string, updates: Partial<AccountRecord>): Promise<boolean>;
  deleteAccount(ig_user_id: string): Promise<boolean>;
  setDefaultAccount(ig_user_id: string): Promise<boolean>;
  incrementPublishCount(ig_user_id: string, nowSec?: number): Promise<number>;
  listApiKeys(): Promise<ApiKeyRecord[]>;
  createApiKey(name: string, account?: string): Promise<ApiKeyRecord>;
  revokeApiKey(id: string): Promise<boolean>;
  getApiKey(key: string): Promise<ApiKeyRecord | null>;
}

export const DEFAULT_FIREBASE_DB_URL = "https://insta-mcp-default-rtdb.asia-southeast1.firebasedatabase.app";

export function createFirebaseStore(
  dbUrl = process.env.FIREBASE_DATABASE_URL || DEFAULT_FIREBASE_DB_URL,
  fetchFn: typeof fetch = globalThis.fetch,
  authSecret = process.env.FIREBASE_AUTH_SECRET,
): AccountStore {
  const base = dbUrl.replace(/\/+$/, "");

  function buildUrl(path: string): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const url = `${base}${cleanPath}.json`;
    if (authSecret) {
      return `${url}?auth=${encodeURIComponent(authSecret)}`;
    }
    return url;
  }

  async function api<T>(path: string, method = "GET", body?: unknown): Promise<T | null> {
    const url = buildUrl(path);
    const headers: Record<string, string> = { Accept: "application/json" };
    let bodyStr: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyStr = JSON.stringify(body);
    }
    const res = await fetchFn(url, {
      method,
      headers,
      body: bodyStr,
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      const text = await res.text().catch(() => "");
      throw new Error(`Firebase RTDB error (${res.status}): ${text.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  return {
    async listAccounts(): Promise<AccountRecord[]> {
      const data = await api<Record<string, AccountRecord>>("/accounts");
      if (!data || typeof data !== "object") return [];
      return Object.values(data).filter((a): a is AccountRecord => !!a && typeof a.ig_user_id === "string");
    },

    async getAccount(idOrUsername: string): Promise<AccountRecord | null> {
      const clean = idOrUsername.replace(/^@/, "").trim().toLowerCase();
      // First try direct lookup by ID
      const direct = await api<AccountRecord>(`/accounts/${clean}`);
      if (direct && direct.ig_user_id) return direct;

      // Scan accounts by username or ID
      const all = await this.listAccounts();
      const match = all.find(
        (a) =>
          a.ig_user_id === clean ||
          a.username.toLowerCase() === clean,
      );
      return match ?? null;
    },

    async getDefaultAccount(): Promise<AccountRecord | null> {
      const settings = await api<{ active_account_id?: string }>("/settings");
      if (settings?.active_account_id) {
        const byActive = await this.getAccount(settings.active_account_id);
        if (byActive) return byActive;
      }

      const all = await this.listAccounts();
      if (!all.length) return null;
      const markedDefault = all.find((a) => a.is_default);
      return markedDefault || all[0];
    },

    async saveAccount(account: AccountRecord): Promise<void> {
      if (!account.ig_user_id) throw new Error("Account must have an ig_user_id");
      const record: AccountRecord = {
        ...account,
        connected_at: account.connected_at ?? Math.floor(Date.now() / 1000),
        status: account.status ?? "active",
      };
      await api(`/accounts/${account.ig_user_id}`, "PUT", record);
    },

    async updateAccount(ig_user_id: string, updates: Partial<AccountRecord>): Promise<boolean> {
      const clean = ig_user_id.replace(/^@/, "").trim().toLowerCase();
      const existing = await this.getAccount(clean);
      if (!existing) return false;
      await api(`/accounts/${existing.ig_user_id}`, "PATCH", updates);
      return true;
    },

    async deleteAccount(ig_user_id: string): Promise<boolean> {
      await api(`/accounts/${ig_user_id}`, "DELETE");
      return true;
    },

    async setDefaultAccount(ig_user_id: string): Promise<boolean> {
      const all = await this.listAccounts();
      const target = all.find((a) => a.ig_user_id === ig_user_id || a.username.toLowerCase() === ig_user_id.toLowerCase());
      if (!target) return false;

      // Update settings
      await api("/settings", "PUT", { active_account_id: target.ig_user_id });

      // Update default flags across accounts
      await Promise.all(
        all.map(async (acc) => {
          const isDef = acc.ig_user_id === target.ig_user_id;
          if (acc.is_default !== isDef) {
            await api(`/accounts/${acc.ig_user_id}`, "PATCH", { is_default: isDef });
          }
        }),
      );
      return true;
    },

    async incrementPublishCount(ig_user_id: string, nowSec = Math.floor(Date.now() / 1000)): Promise<number> {
      const account = await this.getAccount(ig_user_id);
      if (!account) throw new Error(`Cannot increment budget: account ${ig_user_id} not found.`);

      const budget = account.publish_budget || { count_24h: 0, window_start: nowSec };
      const elapsed = nowSec - (budget.window_start || nowSec);
      let newCount = (budget.count_24h || 0) + 1;
      let newStart = budget.window_start || nowSec;

      if (elapsed >= 86400) {
        newCount = 1;
        newStart = nowSec;
      }

      await api(`/accounts/${account.ig_user_id}/publish_budget`, "PUT", {
        count_24h: newCount,
        window_start: newStart,
      });

      return newCount;
    },

    async listApiKeys(): Promise<ApiKeyRecord[]> {
      const data = await api<Record<string, ApiKeyRecord>>("/api_keys");
      if (!data || typeof data !== "object") return [];
      return Object.values(data).filter((k): k is ApiKeyRecord => !!k && typeof k.key === "string");
    },

    async createApiKey(name: string, account?: string): Promise<ApiKeyRecord> {
      const crypto = await import("node:crypto");
      const randomPart = crypto.randomBytes(24).toString("base64url");
      const id = `key_${randomPart.slice(0, 16)}`;
      const key = `ig_live_${randomPart}`;
      const rec: ApiKeyRecord = {
        id,
        key,
        name: name.trim() || "API Key",
        account: account?.trim() || undefined,
        created_at: Math.floor(Date.now() / 1000),
        status: "active",
      };
      await api(`/api_keys/${id}`, "PUT", rec);
      return rec;
    },

    async revokeApiKey(id: string): Promise<boolean> {
      const data = await api<ApiKeyRecord>(`/api_keys/${id}`);
      if (!data) return false;
      await api(`/api_keys/${id}`, "PATCH", { status: "revoked" });
      return true;
    },

    async getApiKey(rawKey: string): Promise<ApiKeyRecord | null> {
      const all = await this.listApiKeys();
      const match = all.find((k) => k.key === rawKey && k.status === "active");
      if (match) {
        // Fire-and-forget last_used_at update
        api(`/api_keys/${match.id}`, "PATCH", { last_used_at: Math.floor(Date.now() / 1000) }).catch(() => undefined);
      }
      return match || null;
    },
  };
}
