// Storage abstraction over Vercel KV (Upstash Redis) — small strings only
// (tokens, OAuth codes/grants, counters). Images go to Vercel Blob.
// Functions take an explicit Store so unit tests can inject a memory store.

import { kv } from "@vercel/kv";

export interface Store {
  get(key: string): Promise<string | null>;
  /** ex = TTL seconds (KV minimum granularity is fine for our uses). */
  set(key: string, value: string, opts?: { ex?: number }): Promise<void>;
  del(key: string): Promise<void>;
}

export const kvStore: Store = {
  async get(key) {
    const v = await kv.get<string>(key);
    return v ?? null;
  },
  async set(key, value, opts) {
    if (opts?.ex) await kv.set(key, value, { ex: opts.ex });
    else await kv.set(key, value);
  },
  async del(key) {
    await kv.del(key);
  },
};

/** In-memory Store for tests / local runs without KV. */
export function memoryStore(): Store & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    async get(key) {
      return raw.get(key) ?? null;
    },
    async set(key, value) {
      raw.set(key, value);
    },
    async del(key) {
      raw.delete(key);
    },
  };
}
