// MCP tool schemas (zod) + business logic.
// Every publishing tool accepts dry_run (default true): dry runs return a
// preview and perform NO network calls; publishing happens only when
// dry_run=false. Results are plain JSON ({ok:true,...}/{ok:false,error}).

import { z } from "zod";
import { IgApiError, graphCall, type FetchFn } from "./graph";
import {
  BudgetExceededError,
  checkBudget,
  createContainer,
  getContainerStatus,
  IgConfigError,
  loadCreds,
  makeGraphCtx,
  publishContainer,
  recordPublish,
  waitForImageContainer,
  type GraphCtx,
  type IgDeps,
} from "./ig";
import { computeBestPostingTime } from "./besttime";
import { generateImage, type Aspect } from "./images";

export interface ToolCtx {
  deps: IgDeps;
  origin: string;
}

export type OkResult = Record<string, unknown> & { ok: true };
export type FailResult = { ok: false; error: string };
export type ToolResult = OkResult | FailResult;

export function fail(e: unknown): FailResult {
  const msg = e instanceof Error ? e.message : String(e);
  return { ok: false, error: msg.slice(0, 1000) };
}

async function ensureGraph(ctx: ToolCtx, targetAccount?: string): Promise<GraphCtx> {
  const creds = await loadCreds(ctx.deps, targetAccount);
  return makeGraphCtx(ctx.deps, creds);
}

function dryPreview(action: string, preview: Record<string, unknown>): OkResult {
  return {
    ok: true,
    dry_run: true,
    action,
    preview,
    note: "Dry run — nothing was published. Re-run with dry_run=false to publish for real.",
  };
}

// --- schemas ----------------------------------------------------------------

export const DryRun = z.boolean().optional().describe("Preview only when true/omitted; publish only when explicitly false.");
export const AccountParam = z
  .string()
  .optional()
  .describe("Instagram username (without @) or numeric ID. Defaults to the active account if omitted.");

export const S_ig_list_accounts = z.object({});

export const S_ig_set_active_account = z.object({
  account: z.string().describe("Instagram username (without @) or numeric ID to set as active default."),
});

export const S_ig_me = z.object({
  account: AccountParam,
});

export const S_ig_post = z.object({
  image_url: z.string().url().describe("PUBLIC https URL of the photo (Meta's servers must fetch it)."),
  caption: z.string().max(2200).optional().describe("Caption text (max 2200 chars)."),
  dry_run: DryRun,
  account: AccountParam,
});

export const S_ig_reel = z.object({
  video_url: z.string().url().describe("PUBLIC https URL of the video file (MP4 recommended)."),
  caption: z.string().max(2200).optional().describe("Caption text."),
  cover_url: z.string().url().optional().describe("PUBLIC https URL of the cover image."),
  dry_run: DryRun,
  account: AccountParam,
});

export const S_ig_story = z.object({
  image_url: z.string().url().optional().describe("PUBLIC https URL of the story image (JPEG 9:16 best). Pass exactly one of image_url / video_url."),
  video_url: z.string().url().optional().describe("PUBLIC https URL of the story video. Pass exactly one of image_url / video_url."),
  dry_run: DryRun,
  account: AccountParam,
});

export const S_ig_carousel_item = z.object({
  image_url: z.string().url().optional().describe("PUBLIC https URL of an image child. Pass exactly one of image_url / video_url."),
  video_url: z.string().url().optional().describe("PUBLIC https URL of a video child. Pass exactly one of image_url / video_url."),
  dry_run: DryRun,
  account: AccountParam,
});

export const S_ig_carousel = z.object({
  children: z
    .union([z.array(z.string()).min(2).max(10), z.string()])
    .describe("Child container ids from ig_carousel_item (array of 2-10, or comma-separated string)."),
  caption: z.string().max(2200).optional().describe("Caption text."),
  dry_run: DryRun,
  account: AccountParam,
});

export const S_ig_publish = z.object({
  creation_id: z.string().describe("Container id (from a create step) whose status_code is FINISHED."),
  dry_run: DryRun,
  account: AccountParam,
});

export const S_ig_container_status = z.object({
  container_id: z.string().describe("Container id to check (IN_PROGRESS / FINISHED / ERROR)."),
  account: AccountParam,
});

export const S_ig_account_insights = z.object({
  period: z.enum(["day", "week", "days_28"]).optional().describe("Aggregation period (default days_28)."),
  metrics: z
    .array(z.enum(["reach", "views", "accounts_engaged", "follower_count", "profile_views"]))
    .optional()
    .describe("Subset of metrics (default all)."),
  account: AccountParam,
});

export const S_ig_list_media = z.object({
  limit: z.number().int().min(1).max(50).optional().describe("Max media to return (1-50, default 25)."),
  account: AccountParam,
});

export const S_ig_media_insights = z.object({
  media_id: z.string().describe("Published media id."),
  account: AccountParam,
});

export const S_ig_get_comments = z.object({
  media_id: z.string().describe("Published media id."),
  limit: z.number().int().min(1).max(100).optional().describe("Max comments (default 50)."),
  account: AccountParam,
});

export const S_ig_reply_comment = z.object({
  comment_id: z.string().describe("Comment id to reply to."),
  text: z.string().min(1).max(1000).describe("Reply text (max 1000 chars)."),
  account: AccountParam,
});

export const S_ig_audience_demographics = z.object({
  account: AccountParam,
});

export const S_ig_best_posting_time = z.object({
  timezone: z.string().optional().describe("IANA timezone for slots (default Asia/Kolkata)."),
  limit: z.number().int().min(5).max(50).optional().describe("Posts to analyse (default 50)."),
  top_n: z.number().int().min(1).max(10).optional().describe("Top slots to return (default 5)."),
  account: AccountParam,
});

export const S_ig_generate_image = z.object({
  prompt: z.string().min(1).max(2000).describe("Image prompt; brand style is appended automatically."),
  aspect: z.enum(["1:1", "4:5", "9:16"]).optional().describe("Composition hint (default 1:1)."),
  account: AccountParam,
});

export const S_ig_generate_and_post = z.object({
  prompt: z.string().min(1).max(2000).describe("Image prompt for generation."),
  caption: z.string().max(2200).optional().describe("Caption for the post."),
  aspect: z.enum(["1:1", "4:5", "9:16"]).optional().describe("Composition hint (default 1:1)."),
  dry_run: DryRun,
  account: AccountParam,
});

export type T_ig_post = z.infer<typeof S_ig_post>;

// --- account management tools ------------------------------------------------

export async function ig_list_accounts(ctx: ToolCtx, _args?: z.infer<typeof S_ig_list_accounts>): Promise<ToolResult> {
  try {
    if (!ctx.deps.accountStore) {
      const g = await ensureGraph(ctx);
      return {
        ok: true,
        count: 1,
        accounts: [{ ig_user_id: g.userId, username: "default", is_default: true, status: "active" }],
      };
    }
    const all = await ctx.deps.accountStore.listAccounts();
    const sanitized = all.map((a) => {
      const daysLeft = a.token_expires_at
        ? Math.max(0, Math.round((a.token_expires_at * 1000 - Date.now()) / (24 * 3600 * 1000)))
        : null;
      return {
        ig_user_id: a.ig_user_id,
        username: a.username,
        account_type: a.account_type,
        is_default: !!a.is_default,
        status: a.status ?? "active",
        token_expires_days: daysLeft,
        brand_style: a.brand_style,
      };
    });
    return { ok: true, count: sanitized.length, accounts: sanitized };
  } catch (e) {
    return fail(e);
  }
}

export async function ig_set_active_account(ctx: ToolCtx, args: z.infer<typeof S_ig_set_active_account>): Promise<ToolResult> {
  try {
    if (!ctx.deps.accountStore) {
      return { ok: false, error: "Account store is not configured." };
    }
    const ok = await ctx.deps.accountStore.setDefaultAccount(args.account);
    if (!ok) return { ok: false, error: `Account "${args.account}" not found in database.` };
    return { ok: true, active_account: args.account, message: `Account "${args.account}" is now set as the active default.` };
  } catch (e) {
    return fail(e);
  }
}

// --- ported publishing tools --------------------------------------------------

type PollKind = "image" | "video";

async function doCreatePublish(
  ctx: ToolCtx,
  kind: string,
  fields: Record<string, string | undefined>,
  poll: PollKind,
  targetAccount?: string,
): Promise<ToolResult> {
  try {
    const g = await ensureGraph(ctx, targetAccount);
    await checkBudget(ctx.deps, g.userId);
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) clean[k] = v;
    const containerId = await createContainer(g, clean);

    if (poll === "video") {
      let status: string | undefined;
      try {
        status = (await getContainerStatus(g, containerId)).status_code;
      } catch {
        status = undefined;
      }
      if (status === "FINISHED") {
        const mediaId = await publishContainer(g, containerId);
        await recordPublish(ctx.deps, g.userId);
        return { ok: true, mode: kind, container_id: containerId, media_id: mediaId };
      }
      return {
        ok: true,
        status: "processing",
        mode: kind,
        container_id: containerId,
        last_status: status ?? "unknown",
        next: "Video is still processing. Poll ig_container_status, then finalise with ig_publish when status_code is FINISHED.",
      };
    }

    const { finished, lastStatus } = await waitForImageContainer(g, containerId);
    const mediaId = await publishContainer(g, containerId);
    await recordPublish(ctx.deps, g.userId);
    return {
      ok: true,
      mode: kind,
      container_id: containerId,
      media_id: mediaId,
      container_ready: finished,
      ...(finished ? {} : { last_status: lastStatus ?? "unknown", note: "Published after best-effort status wait." }),
    };
  } catch (e) {
    return fail(e);
  }
}

export async function ig_me(ctx: ToolCtx, args?: z.infer<typeof S_ig_me>): Promise<ToolResult> {
  try {
    const g = await ensureGraph(ctx, args?.account);
    const target = g.base.includes("instagram.com") ? "me" : g.userId;
    const account = await graphCall(
      { base: g.base, version: g.version, token: g.token, fetchFn: g.fetchFn },
      "GET",
      target,
      { fields: "id,username,name" },
    );
    return { ok: true, account };
  } catch (e) {
    return fail(e);
  }
}

export async function ig_post(ctx: ToolCtx, args: z.infer<typeof S_ig_post>): Promise<ToolResult> {
  if (args.dry_run !== false) return dryPreview("ig_post", { image_url: args.image_url, caption: args.caption ?? "", account: args.account });
  return doCreatePublish(ctx, "post", { image_url: args.image_url, caption: args.caption }, "image", args.account);
}

export async function ig_reel(ctx: ToolCtx, args: z.infer<typeof S_ig_reel>): Promise<ToolResult> {
  if (args.dry_run !== false)
    return dryPreview("ig_reel", { video_url: args.video_url, caption: args.caption ?? "", cover_url: args.cover_url ?? null, account: args.account });
  return doCreatePublish(
    ctx,
    "reel",
    { media_type: "REELS", video_url: args.video_url, caption: args.caption, cover_url: args.cover_url },
    "video",
    args.account,
  );
}

export async function ig_story(ctx: ToolCtx, args: z.infer<typeof S_ig_story>): Promise<ToolResult> {
  const hasImg = !!args.image_url;
  const hasVid = !!args.video_url;
  if (hasImg === hasVid) return { ok: false, error: "Pass exactly one of image_url / video_url." };
  if (args.dry_run !== false)
    return dryPreview("ig_story", hasImg ? { image_url: args.image_url, account: args.account } : { video_url: args.video_url, account: args.account });
  const fields = hasImg
    ? { media_type: "STORIES", image_url: args.image_url as string }
    : { media_type: "STORIES", video_url: args.video_url as string };
  return doCreatePublish(ctx, hasImg ? "story" : "story-video", fields, hasImg ? "image" : "video", args.account);
}

export async function ig_carousel_item(ctx: ToolCtx, args: z.infer<typeof S_ig_carousel_item>): Promise<ToolResult> {
  const hasImg = !!args.image_url;
  const hasVid = !!args.video_url;
  if (hasImg === hasVid) return { ok: false, error: "Pass exactly one of image_url / video_url." };
  const fields: Record<string, string> = { is_carousel_item: "true" };
  if (hasImg) fields["image_url"] = args.image_url as string;
  else {
    fields["video_url"] = args.video_url as string;
    fields["media_type"] = "REELS";
  }
  if (args.dry_run !== false) return dryPreview("ig_carousel_item", { ...fields, account: args.account });
  try {
    const g = await ensureGraph(ctx, args.account);
    const containerId = await createContainer(g, fields);
    return { ok: true, mode: "carousel-item", container_id: containerId };
  } catch (e) {
    return fail(e);
  }
}

function normalizeChildren(children: string[] | string): { value?: string; error?: string } {
  const list = (Array.isArray(children) ? children : String(children).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length < 2 || list.length > 10) return { error: `Carousel needs 2-10 child container ids (got ${list.length}).` };
  return { value: list.join(",") };
}

export async function ig_carousel(ctx: ToolCtx, args: z.infer<typeof S_ig_carousel>): Promise<ToolResult> {
  const norm = normalizeChildren(args.children);
  if (norm.error) return { ok: false, error: norm.error };
  if (args.dry_run !== false) return dryPreview("ig_carousel", { children: norm.value, caption: args.caption ?? "", account: args.account });
  return doCreatePublish(ctx, "carousel", { media_type: "CAROUSEL", children: norm.value, caption: args.caption }, "video", args.account);
}

export async function ig_publish(ctx: ToolCtx, args: z.infer<typeof S_ig_publish>): Promise<ToolResult> {
  if (args.dry_run !== false) return dryPreview("ig_publish", { creation_id: args.creation_id, account: args.account });
  try {
    const g = await ensureGraph(ctx, args.account);
    await checkBudget(ctx.deps, g.userId);
    const mediaId = await publishContainer(g, args.creation_id);
    await recordPublish(ctx.deps, g.userId);
    return { ok: true, mode: "publish", media_id: mediaId };
  } catch (e) {
    return fail(e);
  }
}

export async function ig_container_status(
  ctx: ToolCtx,
  args: z.infer<typeof S_ig_container_status>,
): Promise<ToolResult> {
  try {
    const g = await ensureGraph(ctx, args.account);
    const st = await getContainerStatus(g, args.container_id);
    return { ok: true, container_id: args.container_id, ...st.raw };
  } catch (e) {
    return fail(e);
  }
}

// --- analytics tools ------------------------------------------------------------

const ACCOUNT_METRICS = ["reach", "views", "accounts_engaged", "follower_count", "profile_views"] as const;
const MEDIA_METRICS = ["reach", "saved", "shares", "views", "total_interactions"] as const;

async function settledInsights(
  g: GraphCtx,
  node: string,
  metrics: string[],
  extra: Record<string, string>,
): Promise<{ insights: Record<string, unknown>; errors: Record<string, string> }> {
  const insights: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  await Promise.all(
    metrics.map(async (metric) => {
      try {
        const res = await graphCall(
          { base: g.base, version: g.version, token: g.token, fetchFn: g.fetchFn },
          "GET",
          `${node}/insights`,
          { metric, ...extra },
        );
        insights[metric] = res["data"] ?? res;
      } catch (e) {
        errors[metric] = e instanceof IgApiError ? e.message : String(e);
      }
    }),
  );
  return { insights, errors };
}

export async function ig_account_insights(
  ctx: ToolCtx,
  args: z.infer<typeof S_ig_account_insights>,
): Promise<ToolResult> {
  try {
    const g = await ensureGraph(ctx, args.account);
    const period = args.period ?? "days_28";
    const metrics = args.metrics?.length ? args.metrics : [...ACCOUNT_METRICS];
    const { insights, errors } = await settledInsights(g, g.userId, metrics, { period });
    return { ok: true, period, insights, ...(Object.keys(errors).length ? { errors } : {}) };
  } catch (e) {
    return fail(e);
  }
}

export async function ig_list_media(ctx: ToolCtx, args: z.infer<typeof S_ig_list_media>): Promise<ToolResult> {
  try {
    const g = await ensureGraph(ctx, args.account);
    const limit = args.limit ?? 25;
    const res = await graphCall(
      { base: g.base, version: g.version, token: g.token, fetchFn: g.fetchFn },
      "GET",
      `${g.userId}/media`,
      {
        fields: "id,caption,permalink,timestamp,media_type,media_product_type,like_count,comments_count,thumbnail_url",
        limit,
      },
    );
    const data = Array.isArray(res["data"]) ? res["data"] : [];
    return { ok: true, count: data.length, media: data };
  } catch (e) {
    return fail(e);
  }
}

export async function ig_media_insights(
  ctx: ToolCtx,
  args: z.infer<typeof S_ig_media_insights>,
): Promise<ToolResult> {
  try {
    const g = await ensureGraph(ctx, args.account);
    const { insights, errors } = await settledInsights(g, args.media_id, [...MEDIA_METRICS], {});
    return { ok: true, media_id: args.media_id, insights, ...(Object.keys(errors).length ? { errors } : {}) };
  } catch (e) {
    return fail(e);
  }
}

export async function ig_get_comments(ctx: ToolCtx, args: z.infer<typeof S_ig_get_comments>): Promise<ToolResult> {
  try {
    const g = await ensureGraph(ctx, args.account);
    const res = await graphCall(
      { base: g.base, version: g.version, token: g.token, fetchFn: g.fetchFn },
      "GET",
      `${args.media_id}/comments`,
      { fields: "id,text,username,timestamp,like_count,hidden", limit: args.limit ?? 50 },
    );
    const data = Array.isArray(res["data"]) ? res["data"] : [];
    return { ok: true, media_id: args.media_id, count: data.length, comments: data };
  } catch (e) {
    return fail(e);
  }
}

export async function ig_reply_comment(
  ctx: ToolCtx,
  args: z.infer<typeof S_ig_reply_comment>,
): Promise<ToolResult> {
  try {
    const g = await ensureGraph(ctx, args.account);
    const res = await graphCall(
      { base: g.base, version: g.version, token: g.token, fetchFn: g.fetchFn },
      "POST",
      `${args.comment_id}/replies`,
      { message: args.text },
    );
    return { ok: true, comment_id: args.comment_id, reply_id: res["id"] ?? null };
  } catch (e) {
    return fail(e);
  }
}

const DEMO_BREAKDOWNS = ["country", "city", "age", "gender"] as const;

export async function ig_audience_demographics(
  ctx: ToolCtx,
  args: z.infer<typeof S_ig_audience_demographics>,
): Promise<ToolResult> {
  try {
    const g = await ensureGraph(ctx, args.account);
    const demographics: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    await Promise.all(
      DEMO_BREAKDOWNS.map(async (breakdown) => {
        try {
          const res = await graphCall(
            { base: g.base, version: g.version, token: g.token, fetchFn: g.fetchFn },
            "GET",
            `${g.userId}/insights`,
            { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown },
          );
          demographics[breakdown] = res["data"] ?? res;
        } catch (e) {
          errors[breakdown] = e instanceof IgApiError ? e.message : String(e);
        }
      }),
    );
    return {
      ok: true,
      demographics,
      ...(Object.keys(errors).length
        ? {
            errors,
            note: "Some breakdowns failed (often missing instagram_business_manage_insights scope or insufficient followers). Re-generate the token with that scope if all four fail.",
          }
        : {}),
    };
  } catch (e) {
    return fail(e);
  }
}

export async function ig_best_posting_time(
  ctx: ToolCtx,
  args: z.infer<typeof S_ig_best_posting_time>,
): Promise<ToolResult> {
  try {
    const g = await ensureGraph(ctx, args.account);
    const limit = args.limit ?? 50;
    const timezone = args.timezone ?? "Asia/Kolkata";
    const res = await graphCall(
      { base: g.base, version: g.version, token: g.token, fetchFn: g.fetchFn },
      "GET",
      `${g.userId}/media`,
      { fields: "id,timestamp,like_count,comments_count", limit },
    );
    const data = (Array.isArray(res["data"]) ? res["data"] : []) as Array<{
      timestamp?: string;
      like_count?: number;
      comments_count?: number;
    }>;
    const slots = computeBestPostingTime(
      data
        .filter((m) => typeof m.timestamp === "string")
        .map((m) => ({
          timestamp: m.timestamp as string,
          like_count: m.like_count ?? 0,
          comments_count: m.comments_count ?? 0,
        })),
      timezone,
      args.top_n ?? 5,
    );
    return { ok: true, timezone, posts_analysed: data.length, top_slots: slots };
  } catch (e) {
    return fail(e);
  }
}

// --- image generation tools -------------------------------------------------------

export async function ig_generate_image(
  ctx: ToolCtx,
  args: z.infer<typeof S_ig_generate_image>,
): Promise<ToolResult> {
  try {
    const aspect = (args.aspect ?? "1:1") as Aspect;
    let brandStyle = ctx.deps.cfg.brandStyle;
    if (args.account && ctx.deps.accountStore) {
      const acc = await ctx.deps.accountStore.getAccount(args.account);
      if (acc?.brand_style) brandStyle = acc.brand_style;
    }
    const cfg = { ...ctx.deps.cfg, brandStyle };
    const out = await generateImage({ cfg, fetchFn: ctx.deps.fetchFn, putBlob: ctx.deps.putBlob }, args.prompt, aspect);
    return { ok: true, ...out };
  } catch (e) {
    return fail(e);
  }
}

export async function ig_generate_and_post(
  ctx: ToolCtx,
  args: z.infer<typeof S_ig_generate_and_post>,
): Promise<ToolResult> {
  try {
    const aspect = (args.aspect ?? "1:1") as Aspect;
    let brandStyle = ctx.deps.cfg.brandStyle;
    if (args.account && ctx.deps.accountStore) {
      const acc = await ctx.deps.accountStore.getAccount(args.account);
      if (acc?.brand_style) brandStyle = acc.brand_style;
    }
    const cfg = { ...ctx.deps.cfg, brandStyle };
    const gen = await generateImage({ cfg, fetchFn: ctx.deps.fetchFn, putBlob: ctx.deps.putBlob }, args.prompt, aspect);
    const caption = args.caption ?? "";
    if (args.dry_run !== false) {
      return dryPreview("ig_generate_and_post", { image_url: gen.url, caption, aspect, prompt_used: gen.prompt_used, account: args.account });
    }
    const pub = await doCreatePublish(ctx, "post", { image_url: gen.url, caption }, "image", args.account);
    if (!pub.ok) return pub;
    return { ...pub, mode: "generate_and_post", image_url: gen.url, prompt_used: gen.prompt_used };
  } catch (e) {
    return fail(e);
  }
}

// --- registry (single source of truth for MCP + OpenAPI docs) ----------------------

export const TOOL_META = [
  { name: "ig_list_accounts", desc: "List all connected Instagram Business/Creator accounts with status and token expiration info." },
  { name: "ig_set_active_account", desc: "Set the default active Instagram account for subsequent tool invocations." },
  { name: "ig_me", desc: "Sanity check: show the active Instagram Business account (id, username, account_type)." },
  { name: "ig_post", desc: "Publish a feed PHOTO. image_url must be a PUBLIC https URL. Dry-run preview by default; publishes only when dry_run=false." },
  { name: "ig_reel", desc: "Publish a REEL. video_url must be a PUBLIC https URL. Videos transcode async: returns a container_id with 'processing' status; finalise with ig_publish. Dry-run preview by default." },
  { name: "ig_story", desc: "Publish a STORY from exactly one of image_url / video_url (public https). Stories expire after 24h; no stickers/polls/links via API. Dry-run preview by default." },
  { name: "ig_carousel_item", desc: "Create ONE carousel child container (image or video). Returns container_id; combine 2-10 via ig_carousel. Dry-run preview by default." },
  { name: "ig_carousel", desc: "Publish a CAROUSEL from 2-10 child container ids (array or comma-separated). Dry-run preview by default." },
  { name: "ig_publish", desc: "Publish an existing container id whose status_code is FINISHED. Dry-run preview by default." },
  { name: "ig_container_status", desc: "Check a container's status_code (IN_PROGRESS / FINISHED / ERROR)." },
  { name: "ig_account_insights", desc: "Account-level insights: reach, views, accounts_engaged, follower_count, profile_views over day/week/days_28." },
  { name: "ig_list_media", desc: "List recent media (up to 50) with caption, permalink, timestamp, media_type, like_count, comments_count." },
  { name: "ig_media_insights", desc: "Per-media insights: reach, saved, shares, views, total_interactions." },
  { name: "ig_get_comments", desc: "List comments on a media object." },
  { name: "ig_reply_comment", desc: "Reply to a comment (posts immediately)." },
  { name: "ig_audience_demographics", desc: "Follower demographics by country, city, age, gender. Partial failures are reported per breakdown with a re-auth hint." },
  { name: "ig_best_posting_time", desc: "Top posting slots (weekday + hour) from recent posts' likes/comments. Timezone defaults to Asia/Kolkata." },
  { name: "ig_generate_image", desc: "Generate an image (free provider + brand style) at the requested aspect, host it at a PUBLIC https URL usable in ig_post." },
  { name: "ig_generate_and_post", desc: "Generate an image AND post it. Dry-run (default) returns the image URL + caption preview WITHOUT publishing; publishes only when dry_run=false." },
] as const;
