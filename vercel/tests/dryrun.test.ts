// dry_run + budget + image-gen tests with mocked fetch/KV/Blob. No network.

import { describe, expect, it, vi } from "vitest";
import type { Cfg } from "../lib/env";
import { memoryStore } from "../lib/store";
import {
  ig_carousel,
  ig_container_status,
  ig_generate_and_post,
  ig_generate_image,
  ig_post,
  ig_publish,
  ig_reel,
  ig_story,
  type ToolCtx,
} from "../lib/tools";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const CFG: Cfg = {
  adminPassword: "pw",
  igUserId: "999",
  oauthJwtSecret: "test-secret-0123456789abcdef",
  apiVersion: "v26.0",
  graphBase: "https://b",
};

function ctxWith(fetchFn?: ReturnType<typeof vi.fn>, putBlob?: ToolCtx["deps"]["putBlob"]): ToolCtx {
  const store = memoryStore();
  store.raw.set("ig:token", "TESTTOKEN");
  store.raw.set("ig:user_id", "999");
  return { deps: { cfg: CFG, store, fetchFn: fetchFn as unknown as typeof fetch, putBlob }, origin: "https://x.vercel.app" };
}

function bigImage(): Response {
  // fake JPEG bytes (>10KB so the size guard passes)
  return new Response(new Uint8Array(20_000).fill(7), { status: 200, headers: { "content-type": "image/jpeg" } });
}

describe("dry_run behaviour (no Graph calls when previewing)", () => {
  it("ig_post dry_run returns a preview and never calls fetch", async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, {}));
    const res = await ig_post(ctxWith(fetchFn), { image_url: "https://cdn/x.jpg", caption: "hi" });
    expect(res).toMatchObject({ ok: true, dry_run: true, action: "ig_post" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("ig_reel / ig_story / ig_carousel / ig_publish dry_run previews without fetch", async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, {}));
    const ctx = ctxWith(fetchFn);
    expect(await ig_reel(ctx, { video_url: "https://cdn/x.mp4" })).toMatchObject({ ok: true, dry_run: true });
    expect(await ig_story(ctx, { image_url: "https://cdn/x.jpg" })).toMatchObject({ ok: true, dry_run: true });
    expect(await ig_carousel(ctx, { children: ["c1", "c2"] })).toMatchObject({ ok: true, dry_run: true });
    expect(await ig_publish(ctx, { creation_id: "c1" })).toMatchObject({ ok: true, dry_run: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("ig_story rejects zero/two media inputs", async () => {
    const ctx = ctxWith();
    expect(await ig_story(ctx, {})).toMatchObject({ ok: false });
    expect(
      await ig_story(ctx, { image_url: "https://a/b.jpg", video_url: "https://a/b.mp4", dry_run: false }),
    ).toMatchObject({ ok: false });
  });

  it("ig_generate_and_post dry_run generates (mocked) but does NOT publish", async () => {
    const fetchFn = vi.fn(async () => bigImage());
    const putBlob = vi.fn(async (key: string) => ({ url: `https://blob/x/${key}` }));
    const res = await ig_generate_and_post(ctxWith(fetchFn, putBlob), { prompt: "a cat", caption: "meow" });
    expect(res).toMatchObject({ ok: true, dry_run: true, action: "ig_generate_and_post" });
    expect(fetchFn).toHaveBeenCalledTimes(1); // image generation only
    expect(putBlob).toHaveBeenCalledTimes(1);
    expect(String((fetchFn.mock.calls[0] as unknown as [unknown])[0])).toContain("image.pollinations.ai");
  });

  it("ig_generate_image returns a public URL with requested aspect", async () => {
    const fetchFn = vi.fn(async () => bigImage());
    const putBlob = vi.fn(async (key: string) => ({ url: `https://blob/x/${key}` }));
    const res = await ig_generate_image(ctxWith(fetchFn, putBlob), { prompt: "a cat", aspect: "9:16" });
    expect(res).toMatchObject({ ok: true, aspect: "9:16" });
    expect(String((res as unknown as { url: string }).url)).toContain("https://blob/x/");
  });
});

describe("real publish paths (mocked Graph API)", () => {
  it("ig_post(false) creates -> FINISHED -> publishes and records budget", async () => {
    const fetchFn = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/999/media_publish")) return jsonRes(200, { id: "media1" });
      if (u.includes("/999/media")) return jsonRes(200, { id: "cid1" });
      if (u.includes("/cid1")) return jsonRes(200, { status_code: "FINISHED" });
      return jsonRes(200, {});
    });
    const ctx = ctxWith(fetchFn);
    const res = await ig_post(ctx, { image_url: "https://cdn/x.jpg", caption: "hi", dry_run: false });
    expect(res).toMatchObject({ ok: true, mode: "post", container_id: "cid1", media_id: "media1" });
    expect(await ctx.deps.store.get("ig:pub")).toContain('"count":1');
  });

  it("ig_reel(false) returns 'processing' for video instead of blocking", async () => {
    const fetchFn = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/999/media")) return jsonRes(200, { id: "cidV" });
      return jsonRes(200, { status_code: "IN_PROGRESS" });
    });
    const ctx = ctxWith(fetchFn);
    const res = await ig_reel(ctx, { video_url: "https://cdn/x.mp4", dry_run: false });
    expect(res).toMatchObject({ ok: true, status: "processing", container_id: "cidV" });
    expect(await ctx.deps.store.get("ig:pub")).toBeNull(); // budget untouched
  });

  it("ig_publish(false) past the 95-cap is refused without calling the API", async () => {
    const ctx = ctxWith(vi.fn(async () => jsonRes(200, { id: "m" })));
    await ctx.deps.store.set("ig:pub", JSON.stringify({ start: Date.now(), count: 95 }));
    const res = await ig_publish(ctx, { creation_id: "c1", dry_run: false });
    expect(res).toMatchObject({ ok: false });
    expect(String((res as { error: string }).error)).toMatch(/budget/i);
  });

  it("ig_container_status surfaces status_code", async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, { status_code: "FINISHED", status: "Published" }));
    const res = await ig_container_status(ctxWith(fetchFn), { container_id: "cid9" });
    expect(res).toMatchObject({ ok: true, status_code: "FINISHED" });
  });
});
