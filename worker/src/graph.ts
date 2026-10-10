// Typed Instagram Graph API client.
// Ports ig-write's api_call / friendly_error logic exactly:
//   GET  -> query string, POST/DELETE -> application/x-www-form-urlencoded.
// Retries 429/5xx with backoff; maps Meta errors to friendly messages.
// The access token is NEVER included in error messages or logs.

export type FetchFn = typeof fetch;
export type HttpMethod = "GET" | "POST" | "DELETE";

export interface GraphOpts {
  base: string;
  version: string;
  token: string;
  fetchFn?: FetchFn;
  /** retries after the first attempt (default 3) */
  maxRetries?: number;
  /** per-attempt timeout ms (default 30000) */
  timeoutMs?: number;
}

export interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_data?: unknown;
  };
  _http_status?: number;
}

export class IgApiError extends Error {
  readonly httpStatus: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly expiredToken: boolean;
  readonly missingScope: boolean;
  readonly scopeHint?: string;

  constructor(init: {
    message: string;
    httpStatus: number;
    code?: number;
    subcode?: number;
    expiredToken?: boolean;
    missingScope?: boolean;
    scopeHint?: string;
  }) {
    super(init.message);
    this.name = "IgApiError";
    this.httpStatus = init.httpStatus;
    this.code = init.code;
    this.subcode = init.subcode;
    this.expiredToken = init.expiredToken ?? false;
    this.missingScope = init.missingScope ?? false;
    this.scopeHint = init.scopeHint;
  }
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_BACKOFF_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Defensively strip anything that looks like a token from a string. */
export function redactTokens(s: string): string {
  return s
    .replace(/access_token=[^&\s"']+/gi, "access_token=[REDACTED]")
    .replace(/["']?(access_token|app_secret)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, "$1=[REDACTED]");
}

function backoffMs(attempt: number, retryAfterMs?: number): number {
  const exp = Math.min(500 * 2 ** attempt + Math.random() * 250, MAX_BACKOFF_MS);
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_BACKOFF_MS);
  return exp;
}

function parseRetryAfterMs(res: Response): number | undefined {
  const v = res.headers.get("retry-after");
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(v);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

const SCOPE_PUBLISH = "instagram_business_content_publish";
const SCOPE_ENGAGEMENT = "instagram_manage_engagement";
const SCOPE_DELETE = "instagram_manage_contents";

function scopeHintFor(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.includes("publish") || m.includes("content"))
    return `need scope ${SCOPE_PUBLISH} — re-generate the IG long-lived token with it granted, then re-seed via /admin/seed-token`;
  if (m.includes("like") || m.includes("engagement"))
    return `need scope ${SCOPE_ENGAGEMENT} — not grantable on the Instagram Login path; skip like/unlike`;
  if (m.includes("delete") || m.includes("manage"))
    return `need scope ${SCOPE_DELETE} — may need the Facebook-Login app path and/or app review`;
  return undefined;
}

/** Port of ig-write friendly_error(). */
export function friendlyIgError(status: number, payload: MetaErrorBody): IgApiError {
  const err = payload?.error ?? {};
  const rawMsg = typeof err.message === "string" && err.message ? err.message : `Graph API error (HTTP ${status})`;
  const code = err.code;
  const sub = err.error_subcode;
  const m = rawMsg.toLowerCase();

  const expiredToken =
    code === 190 ||
    /expired|invalid.*token|session.*expired|error validating access token/i.test(rawMsg);

  const missingScope =
    code === 200 ||
    code === 10 ||
    /permission|scope|authorized|not have|\(#200\)/i.test(rawMsg);

  let hint = "";
  if (missingScope) {
    const specific = scopeHintFor(rawMsg);
    hint = specific ? ` (${specific})` : " (likely missing scope — re-generate the token with all scopes in README_DEPLOY.md)";
  } else if (expiredToken) {
    hint = " (token expired or invalid — generate a fresh long-lived token and re-seed via /admin/seed-token)";
  }
  if (sub !== undefined) hint += ` [subcode=${sub}]`;

  return new IgApiError({
    message: redactTokens(`ERROR ${code ?? status}: ${rawMsg}${hint}`),
    httpStatus: status,
    code,
    subcode: sub,
    expiredToken,
    missingScope,
    scopeHint: missingScope ? scopeHintFor(rawMsg) : undefined,
  });
}

export type GraphParams = Record<string, string | number | boolean | undefined | null>;

/**
 * Single Graph API call with retries on 429/5xx and network errors.
 * Throws IgApiError (token-free message) on Meta errors.
 */
export async function graphCall(
  opts: GraphOpts,
  method: HttpMethod,
  path: string,
  params: GraphParams = {},
): Promise<Record<string, unknown>> {
  const fetchFn: FetchFn = opts.fetchFn ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const clean: Record<string, string> = { access_token: opts.token };
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) clean[k] = String(v);
  }

  const url = `${opts.base}/${opts.version}/${path.replace(/^\/+/, "")}`;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      let reqUrl = url;
      let body: string | undefined;
      const headers: Record<string, string> = { Accept: "application/json" };
      if ((method === "POST" || method === "DELETE") && Object.keys(clean).length > 0) {
        body = new URLSearchParams(clean).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      } else if (method === "GET" && Object.keys(clean).length > 0) {
        reqUrl += (reqUrl.includes("?") ? "&" : "?") + new URLSearchParams(clean).toString();
      }
      const res = await fetchFn(reqUrl, { method, headers, body, signal: ctrl.signal });
      clearTimeout(timer);

      if (res.ok) {
        const text = await res.text();
        if (!text) return {};
        try {
          return JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new IgApiError({ message: "ERROR: Graph API returned non-JSON response", httpStatus: res.status });
        }
      }

      // Error status: parse Meta error body if possible.
      let payload: MetaErrorBody = {};
      try {
        payload = (await res.json()) as MetaErrorBody;
      } catch {
        payload = { error: { message: `HTTP ${res.status} ${res.statusText}` } };
      }
      payload._http_status = res.status;

      if (RETRY_STATUSES.has(res.status) && attempt < maxRetries) {
        await sleep(backoffMs(attempt, parseRetryAfterMs(res)));
        continue;
      }
      throw friendlyIgError(res.status, payload);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof IgApiError) {
        // Already classified. Retryable statuses were handled above; only
        // retry network-level failures wrapped below, so rethrow here unless
        // it is a retryable status with attempts left (handled by continue).
        throw e;
      }
      lastErr = e;
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new IgApiError({
        message: redactTokens(`ERROR: network failure calling Graph API: ${msg}`),
        httpStatus: 0,
      });
    }
  }
  throw new IgApiError({
    message: `ERROR: Graph API request failed after retries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    httpStatus: 0,
  });
}
