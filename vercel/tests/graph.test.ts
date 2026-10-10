// Graph client tests: retries, error mapping, token redaction. No network.

import { describe, expect, it, vi } from "vitest";
import { friendlyIgError, graphCall, IgApiError, redactTokens, type FetchFn } from "../lib/graph";

const asFetch = (m: ReturnType<typeof vi.fn>) => m as unknown as FetchFn;

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("graphCall", () => {
  it("GET encodes params in the query string and returns parsed JSON", async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, { id: "123", username: "x" }));
    const res = await graphCall({ base: "https://graph.instagram.com", version: "v26.0", token: "TOK", fetchFn: asFetch(fetchFn) }, "GET", "me", {
      fields: "id,username",
    });
    expect(res).toEqual({ id: "123", username: "x" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("fields=id%2Cusername");
    expect(url).toContain("access_token=TOK");
    expect(init.method).toBe("GET");
  });

  it("POST sends urlencoded body (ig-write parity)", async () => {
    const fetchFn = vi.fn(async () => jsonRes(200, { id: "cid1" }));
    await graphCall({ base: "https://b", version: "v26.0", token: "TOK", fetchFn: asFetch(fetchFn) }, "POST", "99/media", {
      image_url: "https://x/y.jpg",
      caption: "hi",
    });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ "Content-Type": "application/x-www-form-urlencoded" });
    expect(String(init.body)).toContain("image_url=https%3A%2F%2Fx%2Fy.jpg");
  });

  it("retries 429 then succeeds (honours Retry-After implicitly via backoff)", async () => {
    const fetchFn = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(jsonRes(429, { error: { message: "throttled", code: 4 } }, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonRes(200, { id: "ok" }));
    const res = await graphCall(
      { base: "https://b", version: "v26.0", token: "T", maxRetries: 2, fetchFn: asFetch(fetchFn) },
      "GET",
      "me",
    );
    expect(res).toEqual({ id: "ok" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries 500s and throws friendly IgApiError after exhausting retries", async () => {
    const fetchFn = vi.fn(async () => jsonRes(500, { error: { message: "boom", code: 1 } }));
    await expect(
      graphCall({ base: "https://b", version: "v26.0", token: "T", maxRetries: 1, fetchFn: asFetch(fetchFn) }, "GET", "me"),
    ).rejects.toMatchObject({ name: "IgApiError" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry 400s", async () => {
    const fetchFn = vi.fn(async () => jsonRes(400, { error: { message: "bad", code: 100 } }));
    await expect(graphCall({ base: "https://b", version: "v26.0", token: "T", fetchFn: asFetch(fetchFn) }, "GET", "me")).rejects.toBeInstanceOf(
      IgApiError,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("network failures are retried then wrapped without the token", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const err = await graphCall({ base: "https://b", version: "v26.0", token: "SECRET123", fetchFn: asFetch(fetchFn) }, "GET", "me", {}).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(IgApiError);
    expect(String(err.message)).not.toContain("SECRET123");
    expect(fetchFn).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });
});

describe("friendlyIgError", () => {
  it("flags expired tokens (code 190)", () => {
    const e = friendlyIgError(400, { error: { message: "Error validating access token", code: 190 } });
    expect(e.expiredToken).toBe(true);
    expect(e.message).toMatch(/expired|invalid/i);
  });

  it("flags missing scopes with a re-auth hint and subcode", () => {
    const e = friendlyIgError(403, {
      error: { message: "Application does not have permission (#200)", code: 200, error_subcode: 33 },
    });
    expect(e.missingScope).toBe(true);
    expect(e.message).toContain("subcode=33");
    expect(e.message).toMatch(/scope/i);
  });

  it("maps publish errors to the content_publish scope", () => {
    const e = friendlyIgError(400, { error: { message: "No publish permission", code: 200 } });
    expect(e.scopeHint).toMatch(/instagram_business_content_publish/);
  });
});

describe("redactTokens", () => {
  it("strips access_token values from strings", () => {
    expect(redactTokens("x?access_token=ABC123&y=1")).not.toContain("ABC123");
  });
});
