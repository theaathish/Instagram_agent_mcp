// Instagram account state in KV + container lifecycle.
// Ports ig-write's create_container / poll_container / publish_container.
//
// Store keys ("ig:" prefix):
//   ig:token            long-lived user access token (refreshed by cron)
//   ig:user_id          IG-scoped user id
//   ig:token_expires_at epoch seconds
//   ig:pub              {start,count} rolling 24h publish counter

import type { Cfg } from "./env";
import { graphCall, IgApiError, type FetchFn, type GraphParams, type HttpMethod } from "./graph";
import type { Store } from "./store";
import type { AccountStore } from "./firebase";

const K_TOKEN = "ig:token";
const K_USER_ID = "ig:user_id";
const K_EXPIRES_AT = "ig:token_expires_at";
const K_PUB = "ig:pub";

const DAY_MS = 24 * 3600 * 1000;
/** Meta allows ~100 publishes / rolling 24h; refuse past 95 as a safety cap. */
export const PUBLISH_CAP_24H = 95;
/** Refresh the IG token when fewer than this many days remain. */
export const REFRESH_WITHIN_DAYS = 35;

export interface Creds {
  userId: string;
  token: string;
  expiresAt: number | null;
}

export interface GraphCtx {
  base: string;
  version: string;
  token: string;
  userId: string;
  fetchFn?: FetchFn;
}

export class IgConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IgConfigError";
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export interface IgDeps {
  cfg: Cfg;
  store: Store;
  accountStore?: AccountStore;
  fetchFn?: FetchFn;
  putBlob?: (key: string, bytes: ArrayBuffer) => Promise<{ url: string }>;
}

/**
 * Load IG credentials. Supports dynamic multi-account resolution via
 * AccountStore, falling back to KV / env seed when no accounts exist.
 */
export async function loadCreds(deps: IgDeps, targetAccount?: string): Promise<Creds> {
  const { cfg, store, accountStore } = deps;

  if (accountStore) {
    if (targetAccount) {
      const acc = await accountStore.getAccount(targetAccount);
      if (!acc) {
        throw new IgConfigError(`Instagram account "${targetAccount}" not found in database. Connect it in the Admin Panel.`);
      }
      if (acc.token_expires_at && acc.token_expires_at * 1000 <= Date.now()) {
        throw new IgConfigError(`Stored token for account @${acc.username} is expired. Re-authenticate or refresh it in the Admin Panel.`);
      }
      return { userId: acc.ig_user_id, token: acc.access_token, expiresAt: acc.token_expires_at ?? null };
    }

    // No target account specified -> try default active account
    const def = await accountStore.getDefaultAccount();
    if (def) {
      if (def.token_expires_at && def.token_expires_at * 1000 <= Date.now()) {
        throw new IgConfigError(`Stored token for active account @${def.username} is expired. Re-authenticate or refresh it in the Admin Panel.`);
      }
      return { userId: def.ig_user_id, token: def.access_token, expiresAt: def.token_expires_at ?? null };
    }
  }

  // Fallback to KV and env config (single-account mode)
  let token = await store.get(K_TOKEN).catch(() => null);
  let userId = (await store.get(K_USER_ID).catch(() => null)) || cfg.igUserId || "";
  const expiresRaw = await store.get(K_EXPIRES_AT).catch(() => null);
  let expiresAt = expiresRaw ? Number(expiresRaw) : null;
  if (expiresAt !== null && !Number.isFinite(expiresAt)) expiresAt = null;

  if (!token && cfg.igSeedToken) {
    token = cfg.igSeedToken;
    if (!userId) {
      try {
        const me = await graphCall(
          { base: cfg.graphBase, version: cfg.apiVersion, token, fetchFn: deps.fetchFn },
          "GET",
          "me",
          { fields: "id" },
        );
        if (typeof me["id"] === "string") userId = me["id"] as string;
      } catch {
        // keep going; publish calls will surface a clear error
      }
    }
    try {
      await store.set(K_TOKEN, token);
      if (userId) await store.set(K_USER_ID, userId);
    } catch {
      // store write failed; still return creds so the request can proceed
    }
    try {
      const refreshed = await refreshToken(deps, token);
      token = refreshed.token;
      expiresAt = refreshed.expiresAt;
    } catch {
      // keep the seeded token as-is
    }
  }

  if (!token) {
    throw new IgConfigError(
      "No Instagram token configured. Connect an account in the Admin Panel or set IG_LONG_LIVED_TOKEN.",
    );
  }
  if (!userId || userId === "default") {
    throw new IgConfigError(
      "No IG user id configured. Connect an account in the Admin Panel or set IG_USER_ID.",
    );
  }
  if (expiresAt !== null && expiresAt * 1000 <= Date.now()) {
    throw new IgConfigError(
      "Stored Instagram token is expired. Refresh it in the Admin Panel or generate a fresh long-lived token.",
    );
  }
  return { userId, token, expiresAt };
}

export function makeGraphCtx(deps: IgDeps, creds: Creds): GraphCtx {
  return { base: deps.cfg.graphBase, version: deps.cfg.apiVersion, token: creds.token, userId: creds.userId, fetchFn: deps.fetchFn };
}

async function gcall(
  g: GraphCtx,
  method: HttpMethod,
  path: string,
  params?: GraphParams,
): Promise<Record<string, unknown>> {
  return graphCall({ base: g.base, version: g.version, token: g.token, fetchFn: g.fetchFn }, method, path, params);
}

/** GET graph.instagram.com/refresh_access_token — returns new token + expiry. */
export async function refreshToken(
  deps: IgDeps,
  currentToken: string,
): Promise<{ token: string; expiresAt: number }> {
  const res = await graphCall(
    { base: deps.cfg.graphBase, version: deps.cfg.apiVersion, token: currentToken, fetchFn: deps.fetchFn },
    "GET",
    "refresh_access_token",
    { grant_type: "ig_refresh_token" },
  );
  const token = res["access_token"];
  if (typeof token !== "string" || !token) {
    throw new IgApiError({ message: "ERROR: token refresh returned no access_token", httpStatus: 0 });
  }
  const expiresIn = Number(res["expires_in"] ?? 60 * 86400);
  const expiresAt = Math.floor(Date.now() / 1000) + (Number.isFinite(expiresIn) ? expiresIn : 60 * 86400);
  try {
    await deps.store.set(K_TOKEN, token);
    await deps.store.set(K_EXPIRES_AT, String(expiresAt));
  } catch {
    // storage failure should not fail the refresh itself
  }
  return { token, expiresAt };
}

/** Cron entry: refresh when expiry is < 35 days out (or unknown). */
export async function refreshTokenIfNeeded(deps: IgDeps): Promise<{ refreshed: boolean; expiresAt: number | null }> {
  const token = await deps.store.get(K_TOKEN).catch(() => null);
  const active = token || deps.cfg.igSeedToken;
  if (!active) return { refreshed: false, expiresAt: null };
  const raw = await deps.store.get(K_EXPIRES_AT).catch(() => null);
  const expiresAt = raw ? Number(raw) : NaN;
  const daysLeft = Number.isFinite(expiresAt) ? (expiresAt * 1000 - Date.now()) / DAY_MS : 0;
  if (!Number.isFinite(expiresAt) || daysLeft < REFRESH_WITHIN_DAYS) {
    const r = await refreshToken(deps, active);
    return { refreshed: true, expiresAt: r.expiresAt };
  }
  return { refreshed: false, expiresAt };
}

// --- publish budget (rolling 24h) -------------------------------------------

interface PubCounter {
  start: number;
  count: number;
}

export async function checkBudget(deps: IgDeps, targetAccountId?: string): Promise<{ used: number; remaining: number }> {
  if (deps.accountStore && targetAccountId) {
    const acc = await deps.accountStore.getAccount(targetAccountId);
    if (acc?.publish_budget) {
      const budget = acc.publish_budget;
      const nowSec = Date.now() / 1000;
      if (nowSec - (budget.window_start || nowSec) < 86400 && budget.count_24h >= PUBLISH_CAP_24H) {
        const resetInH = Math.ceil(((budget.window_start || nowSec) + 86400 - nowSec) / 3600);
        throw new BudgetExceededError(
          `Publish budget exhausted for @${acc.username} (${budget.count_24h}/${PUBLISH_CAP_24H} per rolling 24h safety cap). Try again in ~${resetInH}h.`,
        );
      }
      return { used: budget.count_24h || 0, remaining: PUBLISH_CAP_24H - (budget.count_24h || 0) };
    }
  }

  let counter: PubCounter = { start: Date.now(), count: 0 };
  try {
    const raw = await deps.store.get(K_PUB);
    if (raw) {
      const parsed = JSON.parse(raw) as PubCounter;
      if (Number.isFinite(parsed.start) && Number.isFinite(parsed.count)) counter = parsed;
    }
  } catch {
    counter = { start: Date.now(), count: 0 };
  }
  if (Date.now() - counter.start > DAY_MS) counter = { start: Date.now(), count: 0 };
  if (counter.count >= PUBLISH_CAP_24H) {
    const resetInH = Math.ceil((counter.start + DAY_MS - Date.now()) / 3600000);
    throw new BudgetExceededError(
      `Publish budget exhausted (${counter.count}/${PUBLISH_CAP_24H} per rolling 24h safety cap, Meta allows ~100). Try again in ~${resetInH}h.`,
    );
  }
  return { used: counter.count, remaining: PUBLISH_CAP_24H - counter.count };
}

export async function recordPublish(deps: IgDeps, targetAccountId?: string): Promise<void> {
  if (deps.accountStore && targetAccountId) {
    try {
      await deps.accountStore.incrementPublishCount(targetAccountId);
    } catch {
      // ignore
    }
  }

  let counter: PubCounter = { start: Date.now(), count: 0 };
  try {
    const raw = await deps.store.get(K_PUB);
    if (raw) counter = JSON.parse(raw) as PubCounter;
  } catch {
    counter = { start: Date.now(), count: 0 };
  }
  if (Date.now() - counter.start > DAY_MS) counter = { start: Date.now(), count: 0 };
  counter.count += 1;
  try {
    await deps.store.set(K_PUB, JSON.stringify(counter));
  } catch {
    // best-effort
  }
}

// --- container lifecycle (port of ig-write) ----------------------------------

/** POST {ig-user-id}/media — returns the container id. */
export async function createContainer(g: GraphCtx, fields: GraphParams): Promise<string> {
  const res = await gcall(g, "POST", `${g.userId}/media`, fields);
  if (typeof res["id"] !== "string") {
    throw new IgApiError({ message: `ERROR: no container id returned: ${JSON.stringify(res).slice(0, 300)}`, httpStatus: 0 });
  }
  return res["id"] as string;
}

export interface ContainerStatus {
  status_code?: string;
  status?: string;
  raw: Record<string, unknown>;
}

/** GET {container-id}?fields=status_code,status */
export async function getContainerStatus(g: GraphCtx, containerId: string): Promise<ContainerStatus> {
  const res = await gcall(g, "GET", containerId, { fields: "status_code,status" });
  return {
    status_code: typeof res["status_code"] === "string" ? (res["status_code"] as string) : undefined,
    status: typeof res["status"] === "string" ? (res["status"] as string) : undefined,
    raw: res,
  };
}

/** POST {ig-user-id}/media_publish — returns the published media id. */
export async function publishContainer(g: GraphCtx, creationId: string): Promise<string> {
  const res = await gcall(g, "POST", `${g.userId}/media_publish`, { creation_id: creationId });
  if (typeof res["id"] !== "string") {
    throw new IgApiError({ message: `ERROR: publish returned no media id: ${JSON.stringify(res).slice(0, 300)}`, httpStatus: 0 });
  }
  return res["id"] as string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Best-effort poll for image containers (bounded wall clock; Vercel Hobby
 * allows 60s functions, so the default deadline is 50s). Returns whether
 * FINISHED was observed. Throws on ERROR/EXPIRED terminal states.
 */
export async function waitForImageContainer(
  g: GraphCtx,
  containerId: string,
  deadlineMs = 50_000,
): Promise<{ finished: boolean; lastStatus?: string }> {
  const start = Date.now();
  let wait = 3000;
  let last: string | undefined;
  for (;;) {
    const st = await getContainerStatus(g, containerId);
    last = st.status_code ?? last;
    if (st.status_code === "FINISHED") return { finished: true, lastStatus: last };
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
      throw new IgApiError({ message: `ERROR: container ${containerId} failed: ${JSON.stringify(st.raw).slice(0, 300)}`, httpStatus: 0 });
    }
    if (Date.now() - start > deadlineMs) return { finished: false, lastStatus: last };
    await sleep(wait);
    wait = Math.min(wait + 2000, 8000);
  }
}

/** Seed/replace the stored token (admin endpoint). Never returns the token. */
export async function seedToken(
  deps: IgDeps,
  token: string,
  userId?: string,
): Promise<{ userId: string; expiresAt: number | null; refreshed: boolean }> {
  if (!token || token.length < 10) throw new IgConfigError("seed-token: token looks invalid (too short).");
  let uid = userId || deps.cfg.igUserId || "";
  if (!uid) {
    const me = await graphCall(
      { base: deps.cfg.graphBase, version: deps.cfg.apiVersion, token, fetchFn: deps.fetchFn },
      "GET",
      "me",
      { fields: "id" },
    );
    if (typeof me["id"] !== "string") throw new IgConfigError("seed-token: could not resolve IG user id from token; pass user_id explicitly.");
    uid = me["id"] as string;
  }
  await deps.store.set(K_TOKEN, token);
  await deps.store.set(K_USER_ID, uid);
  let expiresAt: number | null = null;
  let refreshed = false;
  try {
    const r = await refreshToken(deps, token);
    expiresAt = r.expiresAt;
    refreshed = true;
  } catch {
    // keep raw token; cron will retry the refresh later
  }
  return { userId: uid, expiresAt, refreshed };
}
