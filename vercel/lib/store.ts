// Storage abstraction over Vercel KV (Upstash Redis) — small strings only
// (tokens, OAuth codes/grants, counters). Images go to Vercel Blob.
// The KV client is loaded lazily so functions boot (with a clear error)
// even before the KV integration is added. Tests inject memoryStore().

export interface Store {
  get(key: string): Promise<string | null>;
  /** ex = TTL seconds. */
  set(key: string, value: string, opts?: { ex?: number }): Promise<void>;
  del(key: string): Promise<void>;
}

type KvLike = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
};

let client: KvLike | null = null;

async function kvClient(): Promise<KvLike> {
  if (client) return client;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error(
      "Vercel KV is not configured. Create a KV database in the Vercel dashboard (Storage tab) and redeploy.",
    );
  }
  const { kv } = await import("@vercel/kv");
  client = kv as unknown as KvLike;
  return client;
}

export const kvStore: Store = {
  async get(key) {
    const v = await (await kvClient()).get<string>(key);
    return v ?? null;
  },
  async set(key, value, opts) {
    if (opts?.ex) await (await kvClient()).set(key, value, { ex: opts.ex });
    else await (await kvClient()).set(key, value);
  },
  async del(key) {
    await (await kvClient()).del(key);
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
