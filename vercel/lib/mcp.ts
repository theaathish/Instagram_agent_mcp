// MCP server over Node Streamable HTTP, stateless (no sessions — fits
// Vercel serverless). One server+transport per request.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Cfg } from "./env";
import type { Store } from "./store";
import { createFirebaseStore, type AccountStore } from "./firebase";
import {
  S_ig_account_insights,
  S_ig_audience_demographics,
  S_ig_best_posting_time,
  S_ig_carousel,
  S_ig_carousel_item,
  S_ig_container_status,
  S_ig_generate_and_post,
  S_ig_generate_image,
  S_ig_get_comments,
  S_ig_list_accounts,
  S_ig_list_media,
  S_ig_me,
  S_ig_media_insights,
  S_ig_post,
  S_ig_publish,
  S_ig_reel,
  S_ig_reply_comment,
  S_ig_set_active_account,
  S_ig_story,
  TOOL_META,
  ig_account_insights,
  ig_audience_demographics,
  ig_best_posting_time,
  ig_carousel,
  ig_carousel_item,
  ig_container_status,
  ig_generate_and_post,
  ig_generate_image,
  ig_get_comments,
  ig_list_accounts,
  ig_list_media,
  ig_me,
  ig_media_insights,
  ig_post,
  ig_publish,
  ig_reel,
  ig_reply_comment,
  ig_set_active_account,
  ig_story,
  type ToolCtx,
} from "./tools";

const SERVER_NAME = "ig-mcp";
const SERVER_VERSION = "2.0.0";

export function buildMcpServer(ctx: ToolCtx): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const desc = (name: string): string => TOOL_META.find((t) => t.name === name)?.desc ?? name;
  const text = (p: Promise<unknown>) =>
    p.then((r) => ({ content: [{ type: "text" as const, text: JSON.stringify(r) }] }));

  server.registerTool("ig_list_accounts", { description: desc("ig_list_accounts"), inputSchema: S_ig_list_accounts }, async (a) => text(ig_list_accounts(ctx, a)));
  server.registerTool("ig_set_active_account", { description: desc("ig_set_active_account"), inputSchema: S_ig_set_active_account }, async (a) => text(ig_set_active_account(ctx, a)));
  server.registerTool("ig_me", { description: desc("ig_me"), inputSchema: S_ig_me }, async (a) => text(ig_me(ctx, a)));
  server.registerTool("ig_post", { description: desc("ig_post"), inputSchema: S_ig_post }, async (a) => text(ig_post(ctx, a)));
  server.registerTool("ig_reel", { description: desc("ig_reel"), inputSchema: S_ig_reel }, async (a) => text(ig_reel(ctx, a)));
  server.registerTool("ig_story", { description: desc("ig_story"), inputSchema: S_ig_story }, async (a) => text(ig_story(ctx, a)));
  server.registerTool("ig_carousel_item", { description: desc("ig_carousel_item"), inputSchema: S_ig_carousel_item }, async (a) => text(ig_carousel_item(ctx, a)));
  server.registerTool("ig_carousel", { description: desc("ig_carousel"), inputSchema: S_ig_carousel }, async (a) => text(ig_carousel(ctx, a)));
  server.registerTool("ig_publish", { description: desc("ig_publish"), inputSchema: S_ig_publish }, async (a) => text(ig_publish(ctx, a)));
  server.registerTool("ig_container_status", { description: desc("ig_container_status"), inputSchema: S_ig_container_status }, async (a) => text(ig_container_status(ctx, a)));
  server.registerTool("ig_account_insights", { description: desc("ig_account_insights"), inputSchema: S_ig_account_insights }, async (a) => text(ig_account_insights(ctx, a)));
  server.registerTool("ig_list_media", { description: desc("ig_list_media"), inputSchema: S_ig_list_media }, async (a) => text(ig_list_media(ctx, a)));
  server.registerTool("ig_media_insights", { description: desc("ig_media_insights"), inputSchema: S_ig_media_insights }, async (a) => text(ig_media_insights(ctx, a)));
  server.registerTool("ig_get_comments", { description: desc("ig_get_comments"), inputSchema: S_ig_get_comments }, async (a) => text(ig_get_comments(ctx, a)));
  server.registerTool("ig_reply_comment", { description: desc("ig_reply_comment"), inputSchema: S_ig_reply_comment }, async (a) => text(ig_reply_comment(ctx, a)));
  server.registerTool("ig_audience_demographics", { description: desc("ig_audience_demographics"), inputSchema: S_ig_audience_demographics }, async (a) => text(ig_audience_demographics(ctx, a)));
  server.registerTool("ig_best_posting_time", { description: desc("ig_best_posting_time"), inputSchema: S_ig_best_posting_time }, async (a) => text(ig_best_posting_time(ctx, a)));
  server.registerTool("ig_generate_image", { description: desc("ig_generate_image"), inputSchema: S_ig_generate_image }, async (a) => text(ig_generate_image(ctx, a)));
  server.registerTool("ig_generate_and_post", { description: desc("ig_generate_and_post"), inputSchema: S_ig_generate_and_post }, async (a) => text(ig_generate_and_post(ctx, a)));

  return server;
}

export function makeToolCtx(cfg: Cfg, store: Store, origin: string, accountStore?: AccountStore): ToolCtx {
  const acctStore = accountStore ?? createFirebaseStore(cfg.firebaseDatabaseUrl, undefined, cfg.firebaseAuthSecret);
  return { deps: { cfg, store, accountStore: acctStore }, origin };
}

/** Vercel parses JSON bodies for us — pass req.body straight through. */
export async function handleMcp(req: VercelRequest, res: VercelResponse, ctx: ToolCtx): Promise<void> {
  const server = buildMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
