// Worker entry: per-request OAuthProvider (resource URLs derived from the
// incoming Host, so workers.dev / custom domains / localhost all work with
// zero config), stateless MCP + REST behind OAuth, public pages + /img/* +
// /openapi.json open, cron refreshes the IG token every 30 days.

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env";
import { handleMcpRequest } from "./mcp";
import { handleRest } from "./rest";
import {
  handleAuthorizeGet,
  handleAuthorizePost,
  handleHome,
  handleSeedGet,
  handleSeedPost,
  type AppEnv,
} from "./auth";
import { serveImage } from "./images";
import { buildOpenApi } from "./openapi";
import { refreshTokenIfNeeded } from "./ig";
import { corsPreflight, json, withCors } from "./util";

function buildProvider(origin: string): OAuthProvider<Env> {
  return new OAuthProvider<Env>({
    apiHandlers: {
      "/mcp": { fetch: (req, env) => handleMcpRequest(req, env) },
      "/api": { fetch: (req, env) => handleRest(req, env) },
    },
    defaultHandler: {
      fetch: (req, env) => routePublic(req, env as unknown as AppEnv),
    },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: ["ig:read", "ig:write", "offline_access"],
    resourceMetadata: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
    },
    // Claude/ChatGPT use DCR or Client ID Metadata Documents respectively.
    clientIdMetadataDocumentEnabled: true,
    // Sliding 90-day grant for a personal connector: stays alive while used.
    refreshTokenIdleTTL: 90 * 86400,
    accessTokenTTL: 3600,
  });
}

async function routePublic(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (path === "/authorize" && method === "GET") return handleAuthorizeGet(request, env);
  if (path === "/authorize" && method === "POST") return handleAuthorizePost(request, env);
  if (path === "/admin/seed-token" && method === "GET") return handleSeedGet();
  if (path === "/admin/seed-token" && method === "POST") return handleSeedPost(request, env);
  if (path === "/openapi.json" && method === "GET") return json(buildOpenApi(url.origin));
  if (path === "/healthz" && method === "GET") return json({ ok: true, service: "ig-mcp", time: new Date().toISOString() });
  if (path === "/" && method === "GET") return handleHome(url.origin);
  if (path.startsWith("/img/") && method === "GET") {
    return serveImage(env, path.slice("/img/".length));
  }
  return json({ ok: false, error: "Not found." }, 404);
}

async function runCron(env: Env): Promise<void> {
  try {
    const r = await refreshTokenIfNeeded(env);
    console.log(`cron: ig refresh ${r.refreshed ? "done" : "skipped"}`);
  } catch (e) {
    console.log(`cron: ig refresh failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    // Purge expired OAuth KV data (codes, old grants). Resource value is
    // irrelevant here; only the KV binding matters.
    const stats = await buildProvider("http://localhost/").purgeExpiredData(env);
    console.log(`cron: oauth purge: ${JSON.stringify(stats)}`);
  } catch (e) {
    console.log(`cron: oauth purge failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method.toUpperCase() === "OPTIONS") return corsPreflight();
    const origin = new URL(request.url).origin;
    const res = await buildProvider(origin).fetch(request, env, ctx);
    return withCors(res, request);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env));
  },
};
