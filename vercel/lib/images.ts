// Image generation -> Vercel Blob (public URL for Meta's crawler).
//
// Default provider is Pollinations.ai (free, no API key): we GET a rendered
// image, then store the bytes in Blob so the URL is stable. If HF_TOKEN is
// set, Hugging Face FLUX.1-schnell is used instead (also free-tier).
// Aspect is real here: width/height are requested from the provider.

import { put } from "@vercel/blob";
import type { Cfg } from "./env";
import type { FetchFn } from "./graph";

export type Aspect = "1:1" | "4:5" | "9:16";

const DIMS: Record<Aspect, { w: number; h: number }> = {
  "1:1": { w: 1024, h: 1024 },
  "4:5": { w: 960, h: 1200 },
  "9:16": { w: 768, h: 1344 },
};

const ASPECT_SUFFIX: Record<Aspect, string> = {
  "1:1": "square 1:1 composition, centered subject",
  "4:5": "vertical 4:5 portrait composition, centered subject with headroom",
  "9:16": "tall vertical 9:16 story composition, centered subject with generous headroom top and bottom",
};

export interface ImageDeps {
  cfg: Cfg;
  fetchFn?: FetchFn;
  /** Override Blob upload in tests. */
  putBlob?: (key: string, bytes: ArrayBuffer) => Promise<{ url: string }>;
}

function datedName(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 10);
  return `img/${ymd}/${Date.now()}-${rand}.jpg`;
}

async function generateViaPollinations(prompt: string, aspect: Aspect, fetchFn: FetchFn): Promise<ArrayBuffer> {
  const { w, h } = DIMS[aspect];
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${w}&height=${h}&seed=${Math.floor(Math.random() * 1e9)}&nologo=true&model=flux`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55_000);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal, headers: { Accept: "image/*" } });
    if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 10_000) throw new Error("Pollinations returned a suspiciously small payload");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function generateViaHF(prompt: string, aspect: Aspect, token: string, fetchFn: FetchFn): Promise<ArrayBuffer> {
  const { w, h } = DIMS[aspect];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55_000);
  try {
    const res = await fetchFn("https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "image/*" },
      body: JSON.stringify({ inputs: `${prompt} (${ASPECT_SUFFIX[aspect]})`, parameters: { width: w, height: h, num_inference_steps: 4 } }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Hugging Face HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    return res.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
}

export async function generateImage(
  deps: ImageDeps,
  prompt: string,
  aspect: Aspect = "1:1",
): Promise<{ url: string; key: string; prompt_used: string; aspect: Aspect; provider: string; note: string }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const style = (deps.cfg.brandStyle || "").trim();
  const promptUsed = `${prompt.trim()}, ${ASPECT_SUFFIX[aspect]}${style ? `, ${style}` : ""}`;

  const provider = deps.cfg.hfToken ? "huggingface:FLUX.1-schnell" : "pollinations:flux";
  const bytes = deps.cfg.hfToken
    ? await generateViaHF(promptUsed, aspect, deps.cfg.hfToken, fetchFn)
    : await generateViaPollinations(promptUsed, aspect, fetchFn);

  const key = datedName();
  const blob = deps.putBlob
    ? await deps.putBlob(key, bytes)
    : await put(key, bytes, { access: "public", contentType: "image/jpeg", addRandomSuffix: false });
  const override = (deps.cfg.publicImageBaseUrl || "").replace(/\/+$/, "");
  return {
    url: override ? `${override}/${key}` : blob.url,
    key,
    prompt_used: promptUsed,
    aspect,
    provider,
    note: "Rendered at the requested aspect and stored in Vercel Blob (public https URL for Meta).",
  };
}
