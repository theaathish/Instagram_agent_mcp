// Single-user auth: the /authorize page asks for ADMIN_PASSWORD, then
// completes the OAuth grant for this server's owner. Client metadata shown
// on the page is attacker-controlled -> always HTML-escaped.
// Also hosts the password-protected /admin/seed-token endpoint.

import {
  AuthorizationError,
  CimdFetchError,
  type ConsentDescription,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env";
import { seedToken } from "./ig";
import { escapeHtml, html, json, verifyPassword } from "./util";

export type AppEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

const OWNER_SCOPES = ["ig:read", "ig:write", "offline_access"];
const USER_ID = "admin";

function loginPage(details: ConsentDescription, handle: string): string {
  const name = escapeHtml(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  const scopes = details.scope.length
    ? details.scope.map((s) => `<li><code>${escapeHtml(s)}</code></li>`).join("")
    : "<li><code>ig:read ig:write</code> (default)</li>";
  const loopbackWarn = details.redirectIsLoopback
    ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>"
    : "";
  return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize ${name} — ig-mcp</title>
<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem}input,button{font-size:1rem;padding:.5rem}form>*{display:block;margin:.6rem 0;width:100%;box-sizing:border-box}.row{display:flex;gap:.6rem}.row>*{flex:1}</style>
<h1>Connect <em>${name}</em> to your Instagram MCP?</h1>
<p>${origin} Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${loopbackWarn}
<p>Requested scopes:</p><ul>${scopes}</ul>
<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<label>Admin password <input type="password" name="password" autocomplete="current-password" required></label>
<div class="row"><button name="decision" value="approve" type="submit">Allow</button>
<button name="decision" value="deny" type="submit" formnovalidate>Deny</button></div>
</form>`;
}

function errorPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>ig-mcp</title><body><p>${escapeHtml(message)}</p><p><a href="/authorize">Start over</a></p></body>`;
}

function authErrorResponse(e: unknown): Response {
  if (e instanceof AuthorizationError && e.redirectTo) {
    return Response.redirect(e.redirectTo, 302);
  }
  if (e instanceof AuthorizationError || e instanceof CimdFetchError) {
    const message = e instanceof AuthorizationError ? e.description : "This app could not be verified.";
    return new Response(message, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  throw e;
}

export async function handleAuthorizeGet(request: Request, env: AppEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    const authRequest = await oauth.parseAuthRequest(request);
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    consent.headers.set("content-type", "text/html; charset=utf-8");
    return new Response(loginPage(details, consent.handle), { headers: consent.headers });
  } catch (e) {
    return authErrorResponse(e);
  }
}

export async function handleAuthorizePost(request: Request, env: AppEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const ok = await verifyPassword(String(form.get("password") ?? ""), env.ADMIN_PASSWORD);
    if (!ok) {
      return html(errorPage("Wrong admin password. Go back and try again."), 401);
    }
    const picked = form.getAll("scope").map(String);
    const scope = (picked.length ? picked : OWNER_SCOPES).filter((s) => OWNER_SCOPES.includes(s));
    const approved = await oauth.approveConsent(request, handle, {
      scope: scope.length ? scope : [...OWNER_SCOPES],
    });
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: USER_ID,
      metadata: {},
      scope: approved.request.scope,
      props: { user: USER_ID },
    });
    approved.headers.set("location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (e) {
    return authErrorResponse(e);
  }
}

function seedForm(): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Seed IG token — ig-mcp</title>
<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem}input,button{font-size:1rem;padding:.5rem}form>*{display:block;margin:.6rem 0;width:100%;box-sizing:border-box}</style>
<h1>Seed Instagram token</h1>
<p>Paste a long-lived Instagram user token (see README_DEPLOY.md). It is stored in KV, never logged, and never echoed back.</p>
<form method="post">
<label>Admin password <input type="password" name="password" required></label>
<label>Long-lived token <input type="password" name="token" required></label>
<label>IG user id (optional — auto-detected) <input type="text" name="user_id"></label>
<button type="submit">Save</button></form>`;
}

export async function handleSeedGet(): Promise<Response> {
  return html(seedForm());
}

export async function handleSeedPost(request: Request, env: Env): Promise<Response> {
  const ct = request.headers.get("content-type") || "";
  let password = "";
  let token = "";
  let userId = "";
  try {
    if (ct.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      password = String(body["password"] ?? "");
      token = String(body["token"] ?? "");
      userId = String(body["user_id"] ?? "");
    } else {
      const form = await request.formData();
      password = String(form.get("password") ?? "");
      token = String(form.get("token") ?? "");
      userId = String(form.get("user_id") ?? "");
    }
  } catch {
    return json({ ok: false, error: "Could not parse request body." }, 400);
  }
  if (!(await verifyPassword(password, env.ADMIN_PASSWORD))) {
    // Same shape for wrong password vs missing token: no oracle.
    await seedTokenFailureDelay();
    return ct.includes("application/json")
      ? json({ ok: false, error: "Unauthorized." }, 401)
      : html(errorPage("Unauthorized."), 401);
  }
  try {
    const res = await seedToken(env, token, userId || undefined);
    const out = { ok: true, user_id: res.userId, expires_at: res.expiresAt, refreshed: res.refreshed };
    return ct.includes("application/json") ? json(out) : html(
      `<!doctype html><meta charset="utf-8"><title>ig-mcp</title><body><p>Token saved for IG user ${escapeHtml(res.userId)}. ${res.refreshed ? "Refreshed; cron will keep it fresh." : "Stored as-is; cron will attempt refresh."}</p></body>`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return ct.includes("application/json") ? json({ ok: false, error: msg }, 400) : html(errorPage(msg), 400);
  }
}

function seedTokenFailureDelay(): Promise<void> {
  return new Promise((r) => setTimeout(r, 500));
}

export function handleHome(origin: string): Response {
  return html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ig-mcp</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}code{background:#f3f4f6;padding:.1rem .3rem}</style>
<h1>ig-mcp — Instagram MCP server</h1>
<ul>
<li>MCP endpoint: <code>${escapeHtml(origin)}/mcp</code> (OAuth required)</li>
<li>OpenAPI (Custom GPT Actions): <code>${escapeHtml(origin)}/openapi.json</code></li>
<li>Seed token: <code>${escapeHtml(origin)}/admin/seed-token</code> (admin password)</li>
<li>Health: <code>${escapeHtml(origin)}/healthz</code></li>
</ul>
<p>Setup: see README_DEPLOY.md in the repo.</p>`);
}
