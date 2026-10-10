# ig-mcp (Vercel) — deploy guide (Hobby / free plan)

Remote MCP server for your Instagram Business page on **Vercel only**:
Node serverless functions + Vercel KV (token/OAuth state) + Vercel Blob
(generated images) + Vercel Cron (token refresh) + free image generation.
No Cloudflare, no R2, no paid services.

Endpoints (after deploy, `https://<project>.vercel.app`):

| Path | What |
|---|---|
| `/mcp` (→ `/api/mcp`) | MCP over Streamable HTTP, stateless (OAuth-protected) |
| `/.well-known/oauth-protected-resource` | RFC 9728 discovery for MCP clients |
| `/.well-known/oauth-authorization-server` | RFC 8414 discovery |
| `/api/oauth/authorize`, `/api/oauth/token`, `/api/oauth/register` | Login + token + dynamic client registration |
| `/api/rest/*` | Minimal REST mirrors (same Bearer tokens) |
| `/api/openapi` (alias `/api/openapi.json`) | OpenAPI 3.1 for Custom GPT Actions |
| `/api/admin/seed-token` | One-time token seeding (admin password) |
| `/api/cron/refresh` | Cron (every 30 days, `CRON_SECRET`-guarded) |

## 0. Vercel account (free)

Sign up at <https://vercel.com/signup> (Hobby plan, no card). Install the CLI:
`npm i -g vercel`, then `vercel login`.

## 1. Meta developer app — Instagram API with Instagram Login

Same as before (unchanged from the Cloudflare version):

1. <https://developers.facebook.com/apps> → Create App → add **Instagram API**.
2. Scopes: `instagram_business_basic`, `instagram_business_content_publish`,
   `instagram_business_manage_insights`, `instagram_business_manage_comments`.
   (Like/unlike/delete scopes are not granted on Instagram Login — the
   worker omits those tools on purpose.)
3. **Roles → Testers**: add your IG account, accept the invite.
4. Connect your Business/Creator account; generate a **long-lived token**
   (~60 days) and note your numeric IG user id.

## 2. Deploy the `vercel/` subfolder

In the Vercel dashboard: **Add New → Project → Import
`theaathish/Instagram_agent_mcp`** → set **Root Directory = `vercel`** →
Deploy. (First deploy will report missing env — that's expected; continue.)

Or via CLI from the repo:
```bash
cd vercel
vercel link          # Root Directory: vercel
./scripts/setup.sh
```

## 3. Storage (dashboard, free tiers)

1. **Storage tab → Create Database → KV** (Upstash free tier). This auto-sets
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` on your project. Holds: IG token,
   publish counter, OAuth clients/codes/refresh tokens (all small strings).
2. **Storage tab → Create Store → Blob** (free tier, no settings needed).
   Auto-sets `BLOB_READ_WRITE_TOKEN`. Holds generated images (public URLs).

## 4. Environment variables

Settings → Environment Variables (Production + Preview), or
`vercel env add NAME production`:

| Var | Required | What |
|---|---|---|
| `ADMIN_PASSWORD` | yes | OAuth login + seed page password |
| `IG_USER_ID` | yes | numeric IG user id |
| `OAUTH_JWT_SECRET` | yes | random 32+ chars (`openssl rand -hex 32`) — signs MCP access tokens |
| `CRON_SECRET` | yes | random 32+ chars — Vercel Cron sends it back automatically |
| `IG_LONG_LIVED_TOKEN` | no | one-time seed (skip → use `/api/admin/seed-token`) |
| `BRAND_STYLE` | no | appended to every image prompt |
| `HF_TOKEN` | no | use Hugging Face FLUX.1-schnell instead of Pollinations (both free-tier) |

Redeploy after setting vars (`vercel --prod`).

## 5. Seed + verify

- Open `https://<project>.vercel.app/api/admin/seed-token` (if you skipped
  the token secret), enter password + token. Stored in KV, never logged.
- Cron runs `GET /api/cron/refresh` every 30 days (`0 8 */30 * *`);
  it refreshes the IG token when < 35 days remain.

## 6. Claude — custom connector

Settings → Connectors → Add custom connector →
`https://<project>.vercel.app/mcp` → OAuth login (`ADMIN_PASSWORD`) → Allow.

## 7. ChatGPT

- **Developer mode (Plus/Pro+)**: add MCP server → same `/mcp` URL → OAuth.
- **Free/Go**: Custom GPT → Actions → import
  `https://<project>.vercel.app/api/openapi`; Auth = OAuth,
  Authorization URL `…/api/oauth/authorize`, Token URL `…/api/oauth/token`,
  Scope `ig:read ig:write`.

## 8. Test prompts

```
Use ig_me to show my Instagram account.
List my 10 most recent posts (ig_list_media), top 3 by engagement.
Reach + profile views, last 28 days (ig_account_insights).
Top 5 posting times, Asia/Kolkata (ig_best_posting_time).
Generate "sunrise over Marina Beach" (ig_generate_image) — do NOT publish.
ig_generate_and_post "filter coffee flat-lay", caption "Morning rituals ☕",
dry_run=true first; publish only when I say go (dry_run=false).
```

## Notes & limits (Hobby)

- **Functions:** stateless, `maxDuration: 60` on the image/publish routes
  (Hobby max). Image polls are capped at ~50s; videos return
  `status:"processing"` + `ig_publish` later — never a timeout.
- **Images:** Pollinations (keyless) or HF FLUX.1-schnell → Vercel Blob
  public URL. Real requested aspect (1024² / 960×1200 / 768×1344).
  Generation can take 20–60s; on timeout the tool returns a clear error —
  just retry.
- **Safety:** all writes default `dry_run=true`; 95/24h publish cap.
- **KV free tier** (Upstash via Vercel): ~500k commands/month — this app
  uses a handful per tool call. **Blob free tier**: ~1 GB — hundreds of images.
- Local dev: `vercel dev` (needs `vercel env pull` first so KV/Blob tokens exist).
