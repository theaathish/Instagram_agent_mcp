#!/usr/bin/env bash
# setup.sh — one-time Cloudflare provisioning for ig-mcp-worker (free plan).
# Creates the KV namespace + R2 bucket, wires the KV id into wrangler.jsonc,
# and prints the exact secrets to set. Idempotent-ish: skips creation when
# the KV id is already filled in.
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 not found. Install it first." >&2; exit 1; }; }
need wrangler
need node

if grep -q '"id": "KV_NAMESPACE_ID"' wrangler.jsonc; then
  echo "==> Creating KV namespace ig-mcp-kv ..."
  KV_JSON="$(wrangler kv namespace create ig-mcp-kv 2>/dev/null | grep -o '{[^}]*}' | head -1 || true)"
  KV_ID="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).id)}catch{}})' <<<"$KV_JSON")"
  if [ -z "${KV_ID:-}" ]; then
    echo "Could not parse KV id from wrangler output. Create it manually:" >&2
    echo "  wrangler kv namespace create ig-mcp-kv" >&2
    echo "then paste the id over KV_NAMESPACE_ID (both bindings) in wrangler.jsonc" >&2
    exit 1
  fi
  node -e '
    const fs = require("fs");
    const id = process.argv[1];
    let s = fs.readFileSync("wrangler.jsonc", "utf8");
    s = s.split("KV_NAMESPACE_ID").join(id);
    fs.writeFileSync("wrangler.jsonc", s);
    console.log("wrangler.jsonc updated with KV id " + id);
  ' "$KV_ID"
else
  echo "==> KV id already set in wrangler.jsonc, skipping creation."
fi

echo "==> Creating R2 bucket ig-mcp-images ..."
if wrangler r2 bucket create ig-mcp-images 2>&1 | tail -2; then
  :
else
  echo "(If the bucket already exists, that error is fine — continuing.)"
fi

cat <<'EOF'

==============================================================
Next: set secrets (values never go into git), then deploy.
==============================================================
  wrangler secret put ADMIN_PASSWORD       # password for OAuth login + /admin/seed-token
  wrangler secret put IG_USER_ID           # numeric IG-scoped user id
  wrangler secret put IG_LONG_LIVED_TOKEN  # long-lived IG token (one-time seed; omit to use /admin/seed-token instead)
  wrangler secret put BRAND_STYLE          # e.g. "warm minimal lifestyle photography, soft daylight"

  wrangler deploy

Image URLs are served by the Worker itself as
  https://<your-worker>.workers.dev/img/<key>
so the R2 bucket does NOT need public (r2.dev) access. If you prefer a
custom image domain, set vars.PUBLIC_IMAGE_BASE_URL in wrangler.jsonc.

Full walkthrough: see README_DEPLOY.md
==============================================================
EOF
