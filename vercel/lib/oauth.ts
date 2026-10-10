// Minimal OAuth 2.1 server for a single user (RFC 6749/6750/7591/7636/8414/9207/9728).
// Backed by Vercel KV; access tokens are stateless JWTs (jose, HS256).
//
// Endpoints (wired in api/):
//   GET  /.well-known/oauth-protected-resource   resource metadata (RFC 9728)
//   GET  /.well-known/oauth-authorization-server metadata (RFC 8414)
//   POST /api/oauth/register                     dynamic client registration
//   GET  /api/oauth/authorize                    login + consent page
//   POST /api/oauth/authorize                    password check -> code
//   POST /api/oauth/token                        code exchange + refresh rotation

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { signJwt, verifyJwt } from "./jwt";
import type { Cfg } from "./env";
import type { Store } from "./store";

export const OWNER_SCOPES = ["ig:read", "ig:write", "offline_access"];
const CODE_TTL_S = 600;
const REQ_TTL_S = 600;
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 90 * 86400;

export const mcpResourceOf = (origin: string): string => `${origin}/mcp`;

export interface ClientRec {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name?: string;
  auth_method: "none" | "client_secret_post" | "client_secret_basic";
}

export interface PendingReq {
  client_id: string;
  redirect_uri: string;
  scope: string[];
  state: string;
  code_challenge: string;
  resource: string;
}

export interface Grant {
  client_id: string;
  redirect_uri: string;
  scope: string[];
  resource: string;
}

// --- helpers ------------------------------------------------------------------

export function b64url(n: number): string {
  return randomBytes(n).toString("base64url");
}

export function verifyPassword(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const calc = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const a = Buffer.from(calc);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isLoopback(u: URL): boolean {
  const h = u.hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "[::1]" ||
    h === "::1" ||
    h === "127.0.0.1" ||
    h.startsWith("127.") ||
    h.endsWith(".localhost")
  );
}

/** Redirect URIs: https always; http only on loopback (OAuth 2.1 / RFC 8252). */
export function validRedirectUri(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.username || u.password || u.hash) return false;
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:") return isLoopback(u);
    return false;
  } catch {
    return false;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// --- JWT access tokens ----------------------------------------------------------

export async function mintAccessToken(cfg: Cfg, origin: string, scope: string[]): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(cfg.oauthJwtSecret, {
    scope,
    iss: origin,
    aud: mcpResourceOf(origin),
    sub: "admin",
    jti: b64url(12),
    iat: now,
    exp: now + ACCESS_TTL_S,
  });
}

export async function checkAccessToken(
  cfg: Cfg,
  origin: string,
  token: string,
): Promise<{ scope: string[] } | null> {
  const claims = verifyJwt(cfg.oauthJwtSecret, token);
  if (!claims) return null;
  if (claims.sub !== "admin" || claims.iss !== origin || claims.aud !== mcpResourceOf(origin)) return null;
  const scope = Array.isArray(claims.scope)
    ? (claims.scope as string[])
    : String(claims.scope ?? "").split(" ").filter(Boolean);
  return { scope };
}

export function bearerToken(req: { headers?: Record<string, unknown> }): string | null {
  const h = req.headers?.["authorization"] ?? req.headers?.["Authorization"];
  if (typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// --- discovery metadata -----------------------------------------------------------

export function protectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: mcpResourceOf(origin),
    authorization_servers: [origin],
    scopes_supported: ["ig:read", "ig:write"],
    bearer_methods_supported: ["header"],
  };
}

export function authServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: OWNER_SCOPES,
    authorization_response_iss_parameter_supported: true,
  };
}

/** 401 challenge pointing MCP clients at our metadata (RFC 9728 §5.1). */
export function unauthorizedChallenge(origin: string): { status: 401; headers: Record<string, string>; body: unknown } {
  return {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="ig:read ig:write"`,
    },
    body: { ok: false, error: "Unauthorized. Complete OAuth via the authorization server in /.well-known/oauth-protected-resource." },
  };
}

// --- DCR --------------------------------------------------------------------------

export async function registerClient(
  store: Store,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const uris = body["redirect_uris"];
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === "string" && validRedirectUri(u))) {
    return { status: 400, body: { error: "invalid_redirect_uri", error_description: "Provide at least one https (or loopback http) redirect URI." } };
  }
  const grants = (body["grant_types"] as string[] | undefined) ?? ["authorization_code"];
  if (!grants.includes("authorization_code")) {
    return { status: 400, body: { error: "invalid_client_metadata", error_description: "Only the authorization_code grant is supported." } };
  }
  const method = (body["token_endpoint_auth_method"] as string | undefined) ?? "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
    return { status: 400, body: { error: "invalid_client_metadata", error_description: "Unsupported token_endpoint_auth_method." } };
  }
  const client_id = `cli_${b64url(12)}`;
  const rec: ClientRec = {
    client_id,
    redirect_uris: uris as string[],
    client_name: typeof body["client_name"] === "string" ? (body["client_name"] as string).slice(0, 120) : undefined,
    auth_method: method as ClientRec["auth_method"],
  };
  const resp: Record<string, unknown> = {
    client_id,
    redirect_uris: rec.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: method,
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
  if (method !== "none") {
    rec.client_secret = b64url(24);
    resp["client_secret"] = rec.client_secret;
    resp["client_secret_expires_at"] = 0;
  }
  await store.set(`oauth:client:${client_id}`, JSON.stringify(rec));
  // Read-after-write: surfaces Upstash replication lag immediately.
  let verified = false;
  try {
    const back = await store.get(`oauth:client:${client_id}`);
    verified = !!back && JSON.parse(back as string).client_id === client_id;
  } catch {
    verified = false;
  }
  return { status: 201, body: { ...resp, _stored: verified } };
}

export async function getClient(store: Store, clientId: string): Promise<ClientRec | null> {
  try {
    const raw = await store.get(`oauth:client:${clientId}`);
    return raw ? (JSON.parse(raw) as ClientRec) : null;
  } catch {
    return null;
  }
}

/** Validate client_secret for confidential clients; public (none) clients pass. */
export function checkClientSecret(client: ClientRec, body: Record<string, unknown>, headers: Record<string, unknown>): boolean {
  if (client.auth_method === "none") return true;
  let id = typeof body["client_id"] === "string" ? (body["client_id"] as string) : "";
  let secret = typeof body["client_secret"] === "string" ? (body["client_secret"] as string) : "";
  const auth = headers["authorization"] ?? headers["Authorization"];
  if (!secret && typeof auth === "string") {
    const m = auth.match(/^Basic\s+(.+)$/i);
    if (m) {
      const [cid, sec] = Buffer.from(m[1], "base64").toString("utf8").split(":");
      id = id || cid || "";
      secret = sec || "";
    }
  }
  if (id && id !== client.client_id) return false;
  if (!secret || !client.client_secret) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(client.client_secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- authorize ----------------------------------------------------------------------

export interface ParsedAuth {
  ok: true;
  pendingId: string;
  clientName: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
  scope: string[];
}
export interface AuthError {
  ok: false;
  redirectTo?: string;
  message: string;
}

function oauthRedirect(base: string, params: Record<string, string>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export async function parseAuthorizeRequest(
  store: Store,
  origin: string,
  query: Record<string, string | string[] | undefined>,
): Promise<ParsedAuth | AuthError> {
  const q = (k: string): string => {
    const v = query[k];
    return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
  };
  const client_id = q("client_id");
  const client = client_id ? await getClient(store, client_id) : null;
  if (!client) return { ok: false, message: "Unknown client. Register via POST /api/oauth/register first." };

  const redirect_uri = q("redirect_uri");
  if (!redirect_uri || !client.redirect_uris.includes(redirect_uri)) {
    return { ok: false, message: "redirect_uri is not registered for this client." };
  }
  const fail = (code: string, message: string): AuthError => ({
    ok: false,
    redirectTo: oauthRedirect(redirect_uri, { error: code, error_description: message, state: q("state"), iss: origin }),
    message,
  });

  if (q("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const challenge = q("code_challenge");
  const method = q("code_challenge_method") || "plain";
  if (!challenge) return fail("invalid_request", "code_challenge (PKCE S256) is required.");
  if (method !== "S256") return fail("invalid_request", "Only code_challenge_method=S256 is accepted.");
  const resource = q("resource");
  if (resource && resource !== mcpResourceOf(origin)) {
    return fail("invalid_target", "Unknown resource. Use the exact /mcp URL you connect to.");
  }
  const scope = q("scope")
    ? q("scope").split(" ").filter((s) => OWNER_SCOPES.includes(s))
    : ["ig:read", "ig:write"];
  if (!scope.includes("ig:read")) scope.unshift("ig:read");

  const pending: PendingReq = {
    client_id,
    redirect_uri,
    scope: scope.includes("offline_access") ? scope : [...scope, "offline_access"],
    state: q("state"),
    code_challenge: challenge,
    resource: mcpResourceOf(origin),
  };
  const pendingId = `ar_${b64url(12)}`;
  await store.set(`oauth:req:${pendingId}`, JSON.stringify(pending), { ex: REQ_TTL_S });

  let redirectHost = redirect_uri;
  let loopback = false;
  try {
    const u = new URL(redirect_uri);
    redirectHost = u.host || redirect_uri;
    loopback = u.protocol === "http:";
  } catch {
    // keep raw
  }
  return {
    ok: true,
    pendingId,
    clientName: client.client_name || "Unnamed app",
    redirectHost,
    redirectIsLoopback: loopback,
    scope: pending.scope,
  };
}

export async function approveRequest(
  store: Store,
  cfg: Cfg,
  origin: string,
  pendingId: string,
  password: string,
): Promise<{ redirectTo: string } | { error: string }> {
  if (!verifyPassword(password, cfg.adminPassword)) return { error: "Wrong admin password." };
  const raw = await store.get(`oauth:req:${pendingId}`).catch(() => null);
  if (!raw) return { error: "Login session expired. Start over from your chat app." };
  const pending = JSON.parse(raw) as PendingReq;
  await store.del(`oauth:req:${pendingId}`).catch(() => undefined);
  const client = await getClient(store, pending.client_id);
  if (!client) return { error: "Client no longer registered." };

  const code = `ic_${b64url(24)}`;
  const grant: Grant & { challenge: string } = {
    client_id: pending.client_id,
    redirect_uri: pending.redirect_uri,
    scope: pending.scope,
    resource: pending.resource,
    challenge: pending.code_challenge,
  };
  await store.set(`oauth:code:${code}`, JSON.stringify(grant), { ex: CODE_TTL_S });
  return {
    redirectTo: oauthRedirect(pending.redirect_uri, { code, state: pending.state, iss: origin }),
  };
}

// --- token endpoint -------------------------------------------------------------------

export async function tokenExchange(
  store: Store,
  cfg: Cfg,
  origin: string,
  body: Record<string, unknown>,
  headers: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const grantType = String(body["grant_type"] ?? "");
  if (grantType === "authorization_code") {
    const code = String(body["code"] ?? "");
    const redirect_uri = String(body["redirect_uri"] ?? "");
    const verifier = String(body["code_verifier"] ?? "");
    const client_id = String(body["client_id"] ?? "");
    if (!code || !redirect_uri || !verifier) {
      return { status: 400, body: { error: "invalid_request", error_description: "code, redirect_uri and code_verifier are required." } };
    }
    const raw = await store.get(`oauth:code:${code}`).catch(() => null);
    if (!raw) return { status: 400, body: { error: "invalid_grant", error_description: "Code expired, unknown, or already used." } };
    await store.del(`oauth:code:${code}`).catch(() => undefined); // single-use
    const grant = JSON.parse(raw) as Grant & { challenge: string };
    if (grant.redirect_uri !== redirect_uri) {
      return { status: 400, body: { error: "invalid_grant", error_description: "redirect_uri mismatch." } };
    }
    if (client_id && client_id !== grant.client_id) {
      return { status: 400, body: { error: "invalid_grant", error_description: "client mismatch." } };
    }
    const resource = body["resource"];
    if (resource && String(resource) !== grant.resource) {
      return { status: 400, body: { error: "invalid_target", error_description: "resource mismatch." } };
    }
    if (!verifyPkce(verifier, grant.challenge)) {
      return { status: 400, body: { error: "invalid_grant", error_description: "PKCE verification failed." } };
    }
    const client = await getClient(store, grant.client_id);
    if (!client) return { status: 400, body: { error: "invalid_client" } };
    if (!checkClientSecret(client, body, headers)) {
      return { status: 401, body: { error: "invalid_client", error_description: "Bad client secret." } };
    }
    return { status: 200, body: await issueTokenPair(store, cfg, origin, grant) };
  }

  if (grantType === "refresh_token") {
    const rt = String(body["refresh_token"] ?? "");
    if (!rt) return { status: 400, body: { error: "invalid_request" } };
    const raw = await store.get(`oauth:refresh:${rt}`).catch(() => null);
    if (!raw) return { status: 400, body: { error: "invalid_grant", error_description: "Refresh token expired or revoked." } };
    await store.del(`oauth:refresh:${rt}`).catch(() => undefined); // rotation
    const grant = JSON.parse(raw) as Grant;
    const client = await getClient(store, grant.client_id);
    if (!client) return { status: 400, body: { error: "invalid_client" } };
    if (!checkClientSecret(client, body, headers)) {
      return { status: 401, body: { error: "invalid_client" } };
    }
    const scopeParam = typeof body["scope"] === "string" ? String(body["scope"]).split(" ").filter(Boolean) : undefined;
    const narrowed = scopeParam?.filter((s) => grant.scope.includes(s));
    const effective: Grant = { ...grant, scope: narrowed?.length ? narrowed : grant.scope };
    return { status: 200, body: await issueTokenPair(store, cfg, origin, effective) };
  }

  return { status: 400, body: { error: "unsupported_grant_type" } };
}

async function issueTokenPair(
  store: Store,
  cfg: Cfg,
  origin: string,
  grant: Grant,
): Promise<Record<string, unknown>> {
  const access_token = await mintAccessToken(cfg, origin, grant.scope);
  const refresh_token = `ir_${b64url(32)}`;
  await store.set(`oauth:refresh:${refresh_token}`, JSON.stringify(grant), { ex: REFRESH_TTL_S });
  return {
    access_token,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    scope: grant.scope.join(" "),
    refresh_token,
    resource: grant.resource,
  };
}
