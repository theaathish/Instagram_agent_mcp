// dry_run + budget + status-path tests with a mocked fetch. No network.

import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { serveImage } from "../src/images";
import {
  ig_carousel,
  ig_container_status,
  ig_generate_and_post,
  ig_post,
  ig_publish,
  ig_reel,
  ig_story,
  type ToolCtx,
} from "../src/tools";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeEnv(): Env {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
  return {
    OAUTH_KV: kv,
    IG_KV: kv,
    AI: {} as Ai,
    ADMIN_PASSWORD: "pw",
    IG_USER_ID: "999",
    IG_LONG_LIVED_TOKEN: undefined,
  };
}

function seedTokenEnv(): Env {
  const env = makeEnv();
  const store = new Map<string, string>([
    ["ig:token", "TESTTOKEN"],
    ["ig:user_id", "999"],
  ]);
  env.IG_KV = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
  return env;
}

describe("dry_run behaviour (no network when previewing)", () => {
  it("ig_post dry_run returns a preview and never calls fetch", async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, {}));
    const ctx: ToolCtx = { env: makeEnv(), origin: "https://x.workers.dev", fetchFn: fetchFn as typeof fetch };
    const res = await ig_post(ctx, { image_url: "https://cdn/x.jpg", caption: "hi" });
    expect(res).toMatchObject({ ok: true, dry_run: true, action: "ig_post" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("ig_reel / ig_story / ig_carousel / ig_publish dry_run previews without fetch", async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, {}));
    const ctx: ToolCtx = { env: makeEnv(), origin: "https://x.workers.dev", fetchFn: fetchFn as typeof fetch };
    expect(await ig_reel(ctx, { video_url: "https://cdn/x.mp4" })).toMatchObject({ ok: true, dry_run: true });
    expect(await ig_story(ctx, { image_url: "https://cdn/x.jpg" })).toMatchObject({ ok: true, dry_run: true });
    expect(await ig_carousel(ctx, { children: ["c1", "c2"] })).toMatchObject({ ok: true, dry_run: true });
    expect(await ig_publish(ctx, { creation_id: "c1" })).toMatchObject({ ok: true, dry_run: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("ig_story rejects zero/two media inputs", async () => {
    const ctx: ToolCtx = { env: makeEnv(), origin: "https://x.workers.dev" };
    expect(await ig_story(ctx, {})).toMatchObject({ ok: false });
    expect(
      await ig_story(ctx, { image_url: "https://a/b.jpg", video_url: "https://a/b.mp4", dry_run: false }),
    ).toMatchObject({ ok: false });
  });

  it("ig_carousel rejects fewer than 2 children", async () => {
    const ctx: ToolCtx = { env: makeEnv(), origin: "https://x.workers.dev" };
    expect(await ig_carousel(ctx, { children: ["only"] })).toMatchObject({ ok: false });
  });

  it("ig_generate_and_post dry_run generates but does NOT publish", async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, {}));
    const kvPut = vi.fn(async (_k: string, _v: unknown) => undefined);
    const env = seedTokenEnv();
    env.IG_KV = { ...env.IG_KV, put: kvPut } as unknown as KVNamespace;
    env.AI = { run: async () => new Uint8Array([1, 2, 3]).buffer } as unknown as Ai;
    const ctx: ToolCtx = { env, origin: "https://x.workers.dev", fetchFn: fetchFn as typeof fetch };
    const res = await ig_generate_and_post(ctx, { prompt: "a cat", caption: "meow" });
    expect(res).toMatchObject({ ok: true, dry_run: true, action: "ig_generate_and_post" });
    expect(kvPut).toHaveBeenCalledTimes(1); // image generated + stored in KV
    expect(fetchFn).not.toHaveBeenCalled(); // but nothing published
  });
});

describe("real publish paths (mocked Graph API)", () => {
  it("ig_post(false) creates -> FINISHED -> publishes and records budget", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: unknown) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/999/media_publish")) return jsonRes(200, { id: "media1" });
      if (u.includes("/999/media")) return jsonRes(200, { id: "cid1" });
      if (u.includes("/cid1")) return jsonRes(200, { status_code: "FINISHED" });
      return jsonRes(200, {});
    });
    const ctx: ToolCtx = { env: seedTokenEnv(), origin: "https://x.workers.dev", fetchFn: fetchFn as typeof fetch };
    const res = await ig_post(ctx, { image_url: "https://cdn/x.jpg", caption: "hi", dry_run: false });
    expect(res).toMatchObject({ ok: true, mode: "post", container_id: "cid1", media_id: "media1" });
    expect(await ctx.env.IG_KV.get("ig:pub")).toContain('"count":1');
  });

  it("ig_reel(false) returns 'processing' for video instead of blocking", async () => {
    const fetchFn = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/999/media")) return jsonRes(200, { id: "cidV" });
      return jsonRes(200, { status_code: "IN_PROGRESS" });
    });
    const ctx: ToolCtx = { env: seedTokenEnv(), origin: "https://x.workers.dev", fetchFn: fetchFn as typeof fetch };
    const res = await ig_reel(ctx, { video_url: "https://cdn/x.mp4", dry_run: false });
    expect(res).toMatchObject({ ok: true, status: "processing", container_id: "cidV" });
    expect(await ctx.env.IG_KV.get("ig:pub")).toBeNull(); // budget untouched
  });

  it("ig_publish(false) past the 95-cap is refused without calling the API", async () => {
    const env = seedTokenEnv();
    await env.IG_KV.put("ig:pub", JSON.stringify({ start: Date.now(), count: 95 }));
    const fetchFn = vi.fn(async () => jsonRes(200, { id: "m" }));
    const ctx: ToolCtx = { env, origin: "https://x.workers.dev", fetchFn: fetchFn as typeof fetch };
    const res = await ig_publish(ctx, { creation_id: "c1", dry_run: false });
    expect(res).toMatchObject({ ok: false });
    expect(String((res as { error: string }).error)).toMatch(/budget/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("ig_container_status surfaces status_code", async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, { status_code: "FINISHED", status: "Published" }));
    const ctx: ToolCtx = { env: seedTokenEnv(), origin: "https://x.workers.dev", fetchFn: fetchFn as typeof fetch };
    const res = await ig_container_status(ctx, { container_id: "cid9" });
    expect(res).toMatchObject({ ok: true, status_code: "FINISHED" });
  });

  it("serveImage round-trips KV-stored bytes and rejects traversal", async () => {
    const store = new Map<string, ArrayBuffer>();
    const env = makeEnv();
    env.IG_KV = {
      get: async () => null,
      put: async (k: string, v: ArrayBuffer) => {
        store.set(k, v);
      },
      getWithMetadata: async (k: string) => ({
        value: store.get(k) ?? null,
        metadata: { contentType: "image/png" },
      }),
    } as unknown as KVNamespace;
    const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
    await env.IG_KV.put("img/20250101/x.png", bytes);
    const res = await serveImage(env, "img/20250101/x.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect((await serveImage(env, "../evil")).status).toBe(404);
    expect((await serveImage(env, "img/missing.png")).status).toBe(404);
  });
});
