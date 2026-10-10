#!/usr/bin/env bash
# setup.sh — local checks + Vercel project wiring for ig-mcp (Hobby/free).
# Storage (KV, Blob) is provisioned in the Vercel dashboard (Storage tab);
# this script links the project, pulls env for local dev, and prints the
# exact env vars to set. Never prints secret values.
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 not found." >&2; exit 1; }; }
need vercel
need node

echo "==> Linking Vercel project (Root Directory must be 'vercel') ..."
vercel link 2>&1 | tail -3 || true

echo "==> Pulling env for local dev ..."
vercel env pull .env.development.local 2>&1 | tail -2 || true

cat <<'EOF'

==============================================================
Manual steps in the Vercel dashboard (free Hobby plan):
==============================================================
1. Import this repo, set Root Directory = vercel, deploy once.
2. Storage tab -> Create Database -> KV (Upstash, free tier).
   Storage tab -> Create Store -> Blob (free tier, no config needed).
   Both auto-inject KV_REST_API_URL / KV_REST_API_TOKEN /
   BLOB_READ_WRITE_TOKEN into your project's env.
3. Settings -> Environment Variables, add (Production + Preview):
     ADMIN_PASSWORD       your private login password
     IG_USER_ID           numeric IG user id
     OAUTH_JWT_SECRET     random 32+ chars (openssl rand -hex 32)
     CRON_SECRET          random 32+ chars (Vercel Cron sends it back)
     IG_LONG_LIVED_TOKEN  optional one-time seed (or use /api/admin/seed-token)
     BRAND_STYLE          optional, e.g. "warm minimal lifestyle photography"
     HF_TOKEN             optional: use Hugging Face instead of Pollinations
   or:  vercel env add NAME production
4. Redeploy (or `vercel --prod`). Cron /api/cron/refresh runs every 30 days.
Full walkthrough: see README_DEPLOY_VERCEL.md
==============================================================
EOF
