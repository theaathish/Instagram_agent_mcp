// Image generation (Workers AI flux-1-schnell) -> KV.
// The model returns fixed-size PNG bytes; we store them in the same KV
// namespace (90-day TTL — Meta fetches the image at publish time and hosts
// its own copy, so expiry is safe) and serve them back over https via /img/*
// so Meta's crawler can fetch them. No R2, no paid services: the whole stack
// is Workers + KV + Workers AI, all free-tier. Meta accepts PNG for feed
// posts, so no JPEG transcoding step is needed (Workers have no image codec).

import type { Env } from "./env";
import { imageModel } from "./env";

export type Aspect = "1:1" | "4:5" | "9:16";

/** Generated images live this long in KV (Meta keeps its own copy after publish). */
export const IMAGE_TTL_SECONDS = 90 * 86400;

const ASPECT_SUFFIX: Record<Aspect, string> = {
  "1:1": "square 1:1 composition, centered subject",
  "4:5": "vertical 4:5 portrait composition, centered subject with headroom",
  "9:16": "tall vertical 9:16 story composition, centered subject with generous headroom top and bottom",
};

export interface ImageDeps {
  env: Env;
  /** Public origin used to build the image URL, e.g. https://ig-mcp-agent.workers.dev */
  origin: string;
}

function datedKey(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `img/${ymd}/${crypto.randomUUID()}.png`;
}

function publicBase(env: Env, origin: string): string {
  const override = (env.PUBLIC_IMAGE_BASE_URL || "").replace(/\/+$/, "");
  if (override) return override;
  return origin.replace(/\/+$/, "");
}

/** Normalize Workers AI image output into bytes for KV (small, ~1-2 MB). */
async function toBytes(out: unknown): Promise<ArrayBuffer> {
  if (out instanceof ArrayBuffer) return out;
  if (ArrayBuffer.isView(out)) {
    const v = out as Uint8Array;
    return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
  }
  if (out instanceof ReadableStream) {
    return new Response(out).arrayBuffer();
  }
  if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    // Some models/bindings return { image: "<base64>" }.
    if (typeof o["image"] === "string") {
      const b64 = (o["image"] as string).split(",").pop() as string;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer as ArrayBuffer;
    }
  }
  throw new Error("Workers AI returned an unexpected image payload");
}

export async function generateImage(
  deps: ImageDeps,
  prompt: string,
  aspect: Aspect = "1:1",
): Promise<{ url: string; key: string; prompt_used: string; aspect: Aspect; note: string }> {
  const style = (deps.env.BRAND_STYLE || "").trim();
  const promptUsed = `${prompt.trim()}, ${ASPECT_SUFFIX[aspect]}${style ? `, ${style}` : ""}`;

  // num_steps=4 is the schnell sweet spot (fast + cheap on free-plan neurons).
  const out = (await deps.env.AI.run(imageModel(deps.env), {
    prompt: promptUsed,
    num_steps: 4,
  } as unknown as never)) as unknown;

  const key = datedKey();
  await deps.env.IG_KV.put(key, await toBytes(out), {
    metadata: { contentType: "image/png" },
    expirationTtl: IMAGE_TTL_SECONDS,
  });

  const url = `${publicBase(deps.env, deps.origin)}/img/${key}`;
  return {
    url,
    key,
    prompt_used: promptUsed,
    aspect,
    note: "flux-1-schnell renders a fixed-size square PNG; the aspect value guides composition via the prompt. Meta accepts PNG directly. Stored in KV (90-day TTL).",
  };
}

/** Public GET /img/<key> — serves the stored bytes to Meta's crawler (no auth). */
export async function serveImage(env: Env, key: string): Promise<Response> {
  if (!key || key.includes("..") || !key.startsWith("img/") || key.length > 200) {
    return new Response("Not found", { status: 404 });
  }
  const got = await env.IG_KV.getWithMetadata<{ contentType?: string }>(key, "arrayBuffer");
  if (!got.value) return new Response("Not found", { status: 404 });
  return new Response(got.value, {
    headers: {
      "content-type": got.metadata?.contentType ?? "image/png",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
