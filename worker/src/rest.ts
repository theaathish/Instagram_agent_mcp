// Minimal REST mirrors of the most-used tools, for ChatGPT Custom GPT
// Actions (which cannot speak MCP on most plans). Same Bearer tokens as
// /mcp (enforced by the OAuth provider's apiHandlers map).

import type { Env } from "./env";
import {
  S_ig_generate_and_post,
  S_ig_generate_image,
  S_ig_list_media,
  S_ig_media_insights,
  S_ig_post,
  ig_generate_and_post,
  ig_generate_image,
  ig_list_media,
  ig_me,
  ig_media_insights,
  ig_post,
  type ToolCtx,
} from "./tools";
import { json } from "./util";

function bad(message: string): Response {
  return json({ ok: false, error: message }, 400);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return (body ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Serve GET/POST under /api/* (request already authenticated). */
export async function handleRest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const ctx: ToolCtx = { env, origin: url.origin };
  const method = request.method.toUpperCase();

  if (method === "GET" && (path === "" || path === "account")) {
    return json(await ig_me(ctx, {}));
  }

  if (method === "GET" && path === "media") {
    const limitRaw = url.searchParams.get("limit");
    const parsed = S_ig_list_media.safeParse({ limit: limitRaw === null ? undefined : Number(limitRaw) });
    if (!parsed.success) return bad(parsed.error.issues.map((i) => i.message).join("; "));
    return json(await ig_list_media(ctx, parsed.data));
  }

  const mediaInsights = path.match(/^media\/([^/]+)\/insights$/);
  if (method === "GET" && mediaInsights) {
    const parsed = S_ig_media_insights.safeParse({ media_id: decodeURIComponent(mediaInsights[1]) });
    if (!parsed.success) return bad("Invalid media id.");
    return json(await ig_media_insights(ctx, parsed.data));
  }

  if (method === "POST" && path === "generate-image") {
    const parsed = S_ig_generate_image.safeParse(await readJson(request));
    if (!parsed.success) return bad(parsed.error.issues.map((i) => i.message).join("; "));
    return json(await ig_generate_image(ctx, parsed.data));
  }

  if (method === "POST" && path === "post") {
    const parsed = S_ig_post.safeParse(await readJson(request));
    if (!parsed.success) return bad(parsed.error.issues.map((i) => i.message).join("; "));
    return json(await ig_post(ctx, parsed.data));
  }

  if (method === "POST" && path === "generate-and-post") {
    const parsed = S_ig_generate_and_post.safeParse(await readJson(request));
    if (!parsed.success) return bad(parsed.error.issues.map((i) => i.message).join("; "));
    return json(await ig_generate_and_post(ctx, parsed.data));
  }

  return json({ ok: false, error: "Unknown API route. See /openapi.json." }, 404);
}
