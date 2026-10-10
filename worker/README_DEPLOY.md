# ig-mcp-worker — deploy guide (Cloudflare free plan)

Remote MCP server for your Instagram Business page: analyse, generate images,
and publish posts straight from Claude / ChatGPT chat. The whole stack is
**Workers + KV + Workers AI + cron — all free-tier, no R2, no paid services**.

Endpoints (after deploy, `https://<worker>.workers.dev`):

| Path | What |
|---|---|
| `/mcp` | MCP over Streamable HTTP (OAuth-protected) |
| `/authorize`, `/token`, `/register` | OAuth 2.1 (login + token + dynamic client registration) |
| `/api/*` | Minimal REST mirrors (same Bearer tokens) |
| `/openapi.json` | OpenAPI 3.1 for Custom GPT Actions |
| `/img/<key>` | Public generated images (Meta's crawler fetches these) |
| `/admin/seed-token` | One-time token seeding (admin password) |
| `/healthz` | Health check |

## 1. Meta developer app — Instagram API with Instagram Login

1. Go to <https://developers.facebook.com/apps> → **Create App** (type: Business or Other).
2. **Add Product → Instagram API** (the current Instagram API with Instagram Login).
3. In the app's Instagram API settings, request these scopes:
   - `instagram_business_basic`
   - `instagram_business_content_publish`
   - `instagram_business_manage_insights`
   - `instagram_business_manage_comments`
   
   Do **not** request like/unlike/delete-only scopes on this path — Meta does not
   grant `instagram_manage_engagement` / `instagram_manage_contents` via Instagram
   Login (this worker intentionally omits like/unlike/delete tools for that reason).
4. **Roles → Testers**: add your Instagram account as a tester and accept the invite.
5. Connect your Instagram **Business/Creator** account and generate a **long-lived
   user access token** (~60 days validity). Save:
   - the token (starts with `IGA...` or similar — keep secret)
   - your IG-scoped user id (numeric; returned by the token-debug / `me` call)

## 2. Cloudflare setup

```bash
cd worker
wrangler login
./scripts/setup.sh
```

`setup.sh` creates the KV namespace (`ig-mcp-kv`), patches its id into
`wrangler.jsonc`, and prints the secrets step. Generated images are stored in
that same KV namespace (90-day TTL) — there is nothing else to provision.

```bash
wrangler secret put ADMIN_PASSWORD       # your private login password (OAuth + seed page)
wrangler secret put IG_USER_ID           # numeric IG user id from step 1
wrangler secret put IG_LONG_LIVED_TOKEN  # optional: one-time seed (skip to use /admin/seed-token instead)
wrangler secret put BRAND_STYLE          # e.g. "warm minimal lifestyle photography, soft daylight"
```

Optional local dev (never commit secrets — `.dev.vars` is git-ignored):

```bash
cp .dev.vars.example .dev.vars   # if present; otherwise create with the same keys
wrangler dev
```

## 3. Deploy

```bash
wrangler deploy
# note the URL, e.g. https://ig-mcp-agent.<you>.workers.dev
```

Verify: open `https://<worker>.workers.dev/healthz` → `{"ok":true,...}`.

Seed the token (if you skipped `IG_LONG_LIVED_TOKEN`): open
`https://<worker>.workers.dev/admin/seed-token`, enter the admin password +
token. The worker stores it in KV and best-effort refreshes it immediately to
learn its expiry. **Thereafter the token lives only in KV** and a Cron Trigger
(`0 8 */30 * *`) refreshes it every 30 days automatically.

## 4. Claude — custom connector

Claude (claude.ai, Pro or higher):

1. **Settings → Connectors → Add custom connector**
2. URL: `https://<worker>.workers.dev/mcp`
3. Complete OAuth: your worker shows a login page → enter `ADMIN_PASSWORD` → **Allow**.
4. Back in chat, tools `ig_*` appear. Start with: *"Use ig_me to show my Instagram account."*

## 5. ChatGPT — MCP vs Custom GPT Actions

- **Developer mode (Plus/Pro with developer mode or higher tiers):** add an MCP
  server pointing at `https://<worker>.workers.dev/mcp` and complete the OAuth
  login as above.
- **Free/Go plans cannot add custom MCP servers.** Use a **Custom GPT with
  Actions** instead:
  1. Create a GPT → Configure → **Actions** → import schema from
     `https://<worker>.workers.dev/openapi.json`.
  2. Set Authentication = **OAuth**, Authorization URL =
     `https://<worker>.workers.dev/authorize`, Token URL =
     `https://<worker>.workers.dev/token`, Scope = `ig:read ig:write`.
  3. The GPT can then use the 6 REST endpoints (`account`, `media`,
     `media insights`, `generate-image`, `post`, `generate-and-post`).

## 6. Test prompts (paste into chat)

```
Use ig_me to show my Instagram account.
```

```
List my 10 most recent posts with likes and comments (ig_list_media),
then tell me my top 3 by engagement.
```

```
Show my account reach and profile views for the last 28 days (ig_account_insights).
```

```
What are my top 5 posting times in Asia/Kolkata? (ig_best_posting_time)
```

```
Generate an image of "a sunrise over Marina Beach, Chennai, minimal" (ig_generate_image),
then show me the URL — do NOT publish yet.
```

```
Generate and post "filter coffee flat-lay" with caption "Morning rituals ☕ #Chennai"
using ig_generate_and_post with dry_run=true first; show me the preview, and only
publish when I say go (dry_run=false).
```

```
Check container status for <container_id> (ig_container_status), then publish it (ig_publish, dry_run=false).
```

## Notes & limits (free plan)

- **Stateless MCP** (fresh server per request, no Durable Objects) — the only
  shape that fits the free plan with zero config.
- **Images:** Workers AI `flux-1-schnell` → stored in KV (90-day TTL; Meta
  keeps its own copy once published) → served as `https://<worker>/img/<key>`.
  Flux renders fixed-size square PNGs; the `aspect` parameter guides
  composition via the prompt, and Meta accepts PNG directly (no JPEG step —
  Workers have no image codec on the free plan).
- **Videos:** the worker never blocks on transcoding — reels/carousels return
  `status: "processing"` + `container_id`; finalise with `ig_publish`.
- **Safety:** all write tools default to `dry_run=true`; publish cap 95/24h
  (Meta allows ~100); tokens live in KV, never in logs.
- **Token refresh:** cron every 30 days (`GET refresh_access_token`); IG
  long-lived tokens last ~60 days, so this has 2× headroom. If a refresh ever
  fails, re-seed via `/admin/seed-token`.
- **Costs to watch:** Workers AI free = 10k neurons/day (one schnell image ≈
  well within); KV free = 100k reads/day, 1k writes/day, 1 GB storage (≈500+
  generated images with the 90-day TTL). Normal personal use stays free, and
  no payment method is required for any of it.
