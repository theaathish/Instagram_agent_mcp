// OAuth unit tests: DCR, authorize approve/deny, code exchange with PKCE,
// refresh rotation. Memory store, no network.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Cfg } from "../lib/env";
import { memoryStore } from "../lib/store";
import {
  approveRequest,
  checkAccessToken,
  parseAuthorizeRequest,
  registerClient,
  tokenExchange,
  verifyPassword,
  verifyPkce,
} from "../lib/oauth";

const CFG: Cfg = {
  adminPassword: "correct-horse",
  igUserId: "999",
  oauthJwtSecret: "test-secret-0123456789abcdef",
  apiVersion: "v26.0",
  graphBase: "https://b",
};
const ORIGIN = "https://x.vercel.app";

function pkcePair(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

describe("oauth primitives", () => {
  it("verifyPassword accepts the right password only", () => {
    expect(verifyPassword("correct-horse", "correct-horse")).toBe(true);
    expect(verifyPassword("wrong", "correct-horse")).toBe(false);
  });

  it("verifyPkce implements S256", () => {
    const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(verifyPkce(v, pkcePair(v))).toBe(true);
    expect(verifyPkce(v, pkcePair("other"))).toBe(false);
  });

  it("DCR rejects bad redirect URIs", async () => {
    const store = memoryStore();
    const bad = await registerClient(store, { redirect_uris: ["http://evil.com/cb"] });
    expect(bad.status).toBe(400);
    const ok = await registerClient(store, {
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      client_name: "Claude",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.client_id).toMatch(/^cli_/);
  });
});

describe("full code flow", () => {
  async function setupClient() {
    const store = memoryStore();
    const reg = await registerClient(store, {
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      client_name: "Claude",
    });
    return { store, client_id: reg.body.client_id as string };
  }

  it("authorize -> approve -> token -> use JWT -> refresh rotates", async () => {
    const { store, client_id } = await setupClient();
    const verifier = "test-verifier-1234567890";
    const parsed = await parseAuthorizeRequest(store, ORIGIN, {
      client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      response_type: "code",
      code_challenge: pkcePair(verifier),
      code_challenge_method: "S256",
      state: "s1",
      resource: `${ORIGIN}/mcp`,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const badPw = await approveRequest(store, CFG, ORIGIN, parsed.pendingId, "nope");
    expect("error" in badPw).toBe(true);

    const appr = await approveRequest(store, CFG, ORIGIN, parsed.pendingId, "correct-horse");
    expect("redirectTo" in appr).toBe(true);
    if (!("redirectTo" in appr)) return;
    const redir = new URL(appr.redirectTo);
    expect(redir.searchParams.get("state")).toBe("s1");
    const code = redir.searchParams.get("code") as string;

    // code is single-use: wrong verifier fails and consumes it
    const wrong = await tokenExchange(store, CFG, ORIGIN, {
      grant_type: "authorization_code",
      code,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_verifier: "wrong-verifier",
      client_id,
    }, {});
    expect(wrong.status).toBe(400); // already consumed

    // fresh code for the happy path
    const p2 = await parseAuthorizeRequest(store, ORIGIN, {
      client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      response_type: "code",
      code_challenge: pkcePair(verifier),
      code_challenge_method: "S256",
      state: "s2",
    });
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    const a2 = await approveRequest(store, CFG, ORIGIN, p2.pendingId, "correct-horse");
    if (!("redirectTo" in a2)) throw new Error("approve failed");
    const code2 = new URL(a2.redirectTo).searchParams.get("code") as string;

    const tok = await tokenExchange(store, CFG, ORIGIN, {
      grant_type: "authorization_code",
      code: code2,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_verifier: verifier,
      client_id,
    }, {});
    expect(tok.status).toBe(200);
    const access = tok.body.access_token as string;
    const refresh = tok.body.refresh_token as string;
    expect(tok.body.token_type).toBe("Bearer");

    const checked = await checkAccessToken(CFG, ORIGIN, access);
    expect(checked).not.toBeNull();
    expect(await checkAccessToken(CFG, ORIGIN, "garbage")).toBeNull();

    const ref = await tokenExchange(store, CFG, ORIGIN, { grant_type: "refresh_token", refresh_token: refresh }, {});
    expect(ref.status).toBe(200);
    // old refresh token is rotated away
    const ref2 = await tokenExchange(store, CFG, ORIGIN, { grant_type: "refresh_token", refresh_token: refresh }, {});
    expect(ref2.status).toBe(400);
  });

  it("authorize rejects unregistered redirect URIs without redirecting", async () => {
    const { store, client_id } = await setupClient();
    const out = await parseAuthorizeRequest(store, ORIGIN, {
      client_id,
      redirect_uri: "https://evil.com/cb",
      response_type: "code",
      code_challenge: "x",
      code_challenge_method: "S256",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.redirectTo).toBeUndefined();
  });
});
