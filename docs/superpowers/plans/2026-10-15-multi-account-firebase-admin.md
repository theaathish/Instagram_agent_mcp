# Multi-Account Instagram MCP Server with Firebase & Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the single-account Instagram MCP server into an enterprise multi-account platform powered by Firebase Realtime Database and an authenticated Admin Dashboard on Vercel, removing legacy local Python scripts.

**Architecture:** A lightweight Firebase Realtime Database service layer provides multi-account persistence and partitioned publishing rate-limiting. All 17 existing MCP tools plus 2 new account management tools (`ig_list_accounts`, `ig_set_active_account`) resolve accounts dynamically via an optional `account` argument (defaulting to the active account in Firebase). A modern dark-mode admin dashboard at `/admin` authenticated with Firebase Auth provides full account lifecycle management, while Vercel Cron automatically renews all account tokens approaching expiration.

**Tech Stack:** TypeScript, Node.js, Vercel Serverless, `@modelcontextprotocol/sdk`, Zod, Vitest, Firebase Web SDK v10 (Auth & Realtime Database), Meta Graph API `v26.0`.

**Spec:** [docs/superpowers/specs/2026-10-15-multi-account-firebase-admin-design.md](file:///Users/user/Workspace/Research_strucureo/Instagram_agent_mcp/docs/superpowers/specs/2026-10-15-multi-account-firebase-admin-design.md)

## Global Constraints

- **Node / TypeScript**: Must pass `tsc --noEmit` and all Vitest unit tests in `vercel/`.
- **Firebase Configuration**: Must use exact config (`projectId: "insta-mcp"`, `databaseURL: "https://insta-mcp-default-rtdb.asia-southeast1.firebasedatabase.app"`).
- **Safety Defaults**: All write tools must retain `dry_run=true` by default.
- **Publish Cap**: 95 publishes per 24 hours partitioned per account.
- **Local Removal**: Remove all legacy root Python files (`ig-write`, `ig-mcp-server.py`, `test_ig_write.py`, `requirements.txt`, `__pycache__`).

## Review Focus

1. **Unknown Account Query**: Calling an MCP tool with `account: "nonexistent"` returns a clear error without leaking credentials or crashing.
2. **Fallback to Default Account**: Omitting `account` parameter correctly targets the account marked `is_default: true` (or the first account if none is marked default).
3. **Empty Database Fallback**: If no accounts are in Firebase, fallback to legacy environment variables (`IG_USER_ID`, `IG_LONG_LIVED_TOKEN`) preserves backward compatibility.
4. **Token Expiry Rejection**: If an account's token has expired, tool calls fail fast with an actionable re-auth message before making unnecessary API calls.
5. **Admin Route Protection**: Admin backend endpoints reject unauthorized requests missing credentials.

---

### Task 1: Remove Legacy Local Python Implementation

**Files:**
- Delete: `ig-write`
- Delete: `ig-mcp-server.py`
- Delete: `test_ig_write.py`
- Delete: `requirements.txt`
- Delete: `__pycache__/`

**Interfaces:**
- Consumes: None
- Produces: Clean repository root containing only project documentation and the `vercel/` project folder.

- [ ] **Step 1: Verify local Python test execution before deletion**

Run: `python3 test_ig_write.py`
Expected: Tests pass or report baseline status.

- [ ] **Step 2: Delete legacy local Python files**

Remove `ig-write`, `ig-mcp-server.py`, `test_ig_write.py`, `requirements.txt`, and `__pycache__/`.

- [ ] **Step 3: Verify root cleanliness**

Run: `ls -la`
Expected: Legacy python files are gone; `vercel/`, `docs/`, `README.md`, `LICENSE`, `.gitignore` remain.

- [ ] **Step 4: Commit cleanup**

```bash
git add -A
git commit -m "chore: remove legacy local Python CLI and stdio MCP server"
```

---

### Task 2: Firebase Realtime Database Account Store

**Files:**
- Create: `vercel/lib/firebase.ts`
- Create: `vercel/tests/firebase.test.ts`
- Modify: `vercel/lib/env.ts`

**Interfaces:**
- Consumes: `FIREBASE_DATABASE_URL` (defaults to `https://insta-mcp-default-rtdb.asia-southeast1.firebasedatabase.app`), `FIREBASE_AUTH_SECRET` (optional).
- Produces:
  ```typescript
  export interface AccountRecord {
    ig_user_id: string;
    username: string;
    account_type: string;
    access_token: string;
    token_expires_at?: number;
    granted_scopes?: string[];
    is_default?: boolean;
    brand_style?: string;
    publish_budget?: { count_24h: number; window_start: number };
    connected_at?: number;
    last_refreshed_at?: number;
    status?: "active" | "expired" | "revoked";
  }
  export interface AccountStore {
    listAccounts(): Promise<AccountRecord[]>;
    getAccount(idOrUsername: string): Promise<AccountRecord | null>;
    getDefaultAccount(): Promise<AccountRecord | null>;
    saveAccount(account: AccountRecord): Promise<void>;
    deleteAccount(ig_user_id: string): Promise<boolean>;
    setDefaultAccount(ig_user_id: string): Promise<boolean>;
    incrementPublishCount(ig_user_id: string): Promise<number>;
  }
  export function createFirebaseStore(dbUrl?: string, fetchFn?: typeof fetch): AccountStore;
  ```

- [ ] **Step 1: Write the failing unit tests for Firebase account store**

In `vercel/tests/firebase.test.ts`:
- Test `listAccounts` returns empty array or parsed accounts.
- Test `saveAccount` and `getAccount` by `ig_user_id` and by `username`.
- Test `getDefaultAccount` falls back to first account if none explicitly set.
- Test `setDefaultAccount` updates `is_default` and `settings/active_account_id`.
- Test `incrementPublishCount` resets after 24h window.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/firebase.test.ts`
Expected: FAIL ("cannot find module '../lib/firebase'")

- [ ] **Step 3: Implement `vercel/lib/firebase.ts`**

Implement `createFirebaseStore` with REST-based HTTP fetch calls to Firebase Realtime Database, handling GET/PUT/PATCH/DELETE on `/accounts` and `/settings`. Support in-memory mock fallback when `fetchFn` is mocked.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/firebase.test.ts`
Expected: PASS (all tests pass)

- [ ] **Step 5: Commit**

```bash
git add vercel/lib/firebase.ts vercel/tests/firebase.test.ts vercel/lib/env.ts
git commit -m "feat(storage): add Firebase Realtime Database account store"
```

---

### Task 3: Multi-Account Resolution in Graph Engine & Tool Context

**Files:**
- Modify: `vercel/lib/ig.ts`
- Modify: `vercel/lib/tools.ts`
- Modify: `vercel/lib/mcp.ts`
- Create: `vercel/tests/multiaccount.test.ts`

**Interfaces:**
- Consumes: `AccountStore` from `vercel/lib/firebase.ts`.
- Produces:
  - `ensureGraph(ctx: ToolCtx, targetAccount?: string): Promise<GraphCtx>`
  - `AccountParam` added to all existing tools.
  - New tool: `ig_list_accounts(ctx: ToolCtx)`
  - New tool: `ig_set_active_account(ctx: ToolCtx, args: { account: string })`
  - Total registered tools: 19.

- [ ] **Step 1: Write failing tests for multi-account tool resolution**

In `vercel/tests/multiaccount.test.ts`:
- Test `ig_list_accounts` returns list of sanitized accounts without raw tokens.
- Test `ig_set_active_account` updates the default account.
- Test `ig_me` with `account="brand2"` resolves `brand2` credentials.
- Test `ig_post` with `account="unknown"` returns `{ ok: false, error: "Account not found..." }`.
- Test `ig_post` with no `account` uses the default account.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/multiaccount.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `vercel/lib/ig.ts` and `vercel/lib/tools.ts`**

- Update `ToolCtx` to include `accountStore: AccountStore`.
- Update `ensureGraph` to accept `targetAccount?: string` and look up credentials from `accountStore`, falling back to env vars if store is empty.
- Add `account: AccountParam` to schemas in `tools.ts`.
- Implement `ig_list_accounts` and `ig_set_active_account`.
- Register the 2 new tools in `vercel/lib/mcp.ts` and `TOOL_META`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/multiaccount.test.ts && npm test`
Expected: PASS (all tests pass across all test suites)

- [ ] **Step 5: Commit**

```bash
git add vercel/lib/ig.ts vercel/lib/tools.ts vercel/lib/mcp.ts vercel/tests/multiaccount.test.ts
git commit -m "feat(mcp): add multi-account routing and management tools"
```

---

### Task 4: Admin API Endpoints for Account Management & Validation

**Files:**
- Create: `vercel/api/admin/accounts.ts`
- Create: `vercel/tests/admin-api.test.ts`
- Modify: `vercel/vercel.json`

**Interfaces:**
- Endpoints:
  - `GET /api/admin/accounts`: List all connected accounts (sanitized, with token status).
  - `POST /api/admin/accounts`: Validate a token with Meta's `/me` endpoint, fetch `id`, `username`, `account_type`, and save to Firebase.
  - `DELETE /api/admin/accounts?id=<ig_user_id>`: Remove an account.
  - `POST /api/admin/accounts/default`: Set default account.

- [ ] **Step 1: Write failing test for admin account API**

In `vercel/tests/admin-api.test.ts`:
- Test listing accounts requires authorization (Bearer token or `ADMIN_PASSWORD`).
- Test validating a Meta token queries Meta `/me` and saves verified account.
- Test setting default account.
- Test deleting account.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/admin-api.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `vercel/api/admin/accounts.ts`**

Implement handler supporting `GET`, `POST`, `DELETE`, and `PUT` with auth check via `ADMIN_PASSWORD` header or session cookie/Bearer token.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/admin-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add vercel/api/admin/accounts.ts vercel/tests/admin-api.test.ts vercel/vercel.json
git commit -m "feat(admin): add account management API endpoints"
```

---

### Task 5: Multi-Account Token Refresh Cron

**Files:**
- Modify: `vercel/api/cron/refresh.ts`
- Create: `vercel/tests/cron-multiaccount.test.ts`

**Interfaces:**
- Consumes: `CRON_SECRET` bearer token, `AccountStore`.
- Produces: Refreshes all accounts in Firebase with `< 35` days until expiry and records new expiration timestamps.

- [ ] **Step 1: Write failing test for multi-account cron refresh**

In `vercel/tests/cron-multiaccount.test.ts`:
- Test cron iterates multiple accounts.
- Skips accounts with `> 35` days remaining.
- Refreshes accounts with `< 35` days remaining.
- Updates expiration timestamps in Firebase.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cron-multiaccount.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `vercel/api/cron/refresh.ts`**

Iterate all accounts from `createFirebaseStore().listAccounts()`, refresh each candidate via Meta Graph API `/refresh_access_token`, and persist updated tokens back to Firebase.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cron-multiaccount.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add vercel/api/cron/refresh.ts vercel/tests/cron-multiaccount.test.ts
git commit -m "feat(cron): enable multi-account automated token refresh"
```

---

### Task 6: Modern Admin Panel Dashboard (`/admin`)

**Files:**
- Create: `vercel/public/admin.html`
- Modify: `vercel/vercel.json`

**Interfaces:**
- Consumes: Firebase client config provided by user, Firebase Auth & Realtime Database, `/api/admin/accounts`.
- Produces: Standalone single-page responsive dashboard accessible at `/admin`.

- [ ] **Step 1: Build the UI foundation and layout in `vercel/public/admin.html`**

- Embedded design system with dark mode (`#09090b` background, clean Inter typography, glowing accents, glassmorphic card containers).
- Authentication View: Firebase Auth Sign-In / Sign-Up card with Email/Password and Google Provider.
- Dashboard View (unlocked upon auth):
  - Metric summary cards (Total Connected Accounts, Active Default Account, Tokens Expiring Soon, 24h Published Total).
  - Account Cards Grid:
    - Account avatar/initials, `@username`, `ig_user_id`, `BUSINESS`/`CREATOR` badge.
    - Status pill ("Active", "Expires in X days", "Token Expired").
    - Action buttons: "Set Default", "Verify / Test", "Refresh Token", "Disconnect".
  - "Connect Account" Modal:
    - Direct Token input with "Verify with Meta & Save" button.
    - Brand Style guidance prompt input.
    - Direct link to Meta Graph Explorer / App Dashboard.

- [ ] **Step 2: Update `vercel/vercel.json` rewrite rules**

Add rewrite: `{ "source": "/admin", "destination": "/admin.html" }`.

- [ ] **Step 3: Verify routing and assets**

Run `npm run typecheck` and verify rewrite configuration.

- [ ] **Step 4: Commit**

```bash
git add vercel/public/admin.html vercel/vercel.json
git commit -m "feat(ui): add Firebase-powered multi-account Admin Panel dashboard"
```

---

### Task 7: Full System Verification & Documentation Update

**Files:**
- Modify: `README.md`
- Modify: `vercel/README_DEPLOY_VERCEL.md`

- [ ] **Step 1: Run complete test suite and typechecks**

Run: `cd vercel && npm run typecheck && npm test`
Expected: Zero type errors, all tests pass.

- [ ] **Step 2: Update `README.md` and deployment guide**

Document:
- Multi-account architecture and Firebase integration.
- Admin Panel features and login at `/admin`.
- MCP client config and usage of the `account` parameter and `ig_list_accounts` / `ig_set_active_account` tools.
- Removal of local Python dependencies.

- [ ] **Step 3: Commit documentation**

```bash
git add README.md vercel/README_DEPLOY_VERCEL.md
git commit -m "docs: document multi-account Firebase platform and Admin Panel"
```
