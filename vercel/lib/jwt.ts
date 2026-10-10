// HS256 JWT sign/verify on node:crypto only (no ESM-only dependencies).
// Payload shape matches what lib/oauth.ts mints and checks.

import { createHmac, timingSafeEqual } from "node:crypto";

function b64urlEncode(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export interface JwtClaims {
  sub?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  jti?: string;
  scope?: string[];
  [k: string]: unknown;
}

export function signJwt(secret: string, claims: JwtClaims): string {
  const header = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64urlEncode(JSON.stringify(claims));
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(secret: string, token: string): JwtClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expect = createHmac("sha256", secret).update(`${header}.${body}`).digest();
    const got = b64urlDecode(sig);
    if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;
    const h = JSON.parse(b64urlDecode(header).toString("utf8")) as { alg?: string };
    if (h.alg !== "HS256") return null;
    const claims = JSON.parse(b64urlDecode(body).toString("utf8")) as JwtClaims;
    if (typeof claims.exp === "number" && claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
