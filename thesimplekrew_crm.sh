#!/usr/bin/env bash
# ==============================================================================
# Instagram REST API Script for @thesimplekrew
# Scoped API Key: ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI
# Production URL: https://instagramagentmcp-vercel.vercel.app
# ==============================================================================

set -euo pipefail

API_KEY="ig_live_gjykSUnVhUbjZp3FWitaGTQvU3vNOzhI"
BASE_URL="https://instagramagentmcp-vercel.vercel.app"
TARGET_ACCOUNT="thesimplekrew"

usage() {
  cat <<EOF
==============================================================================
Instagram CRM Runner for @thesimplekrew
==============================================================================

Usage:
  ./thesimplekrew_crm.sh info
      - Verifies account connection and returns details.

  ./thesimplekrew_crm.sh media
      - Fetches the last 5 posts and metrics.

  ./thesimplekrew_crm.sh post <IMAGE_URL> <CAPTION>
      - Publishes a photo to @thesimplekrew.

  ./thesimplekrew_crm.sh generate <IMAGE_PROMPT> <CAPTION>
      - Generates an image with Pollinations AI and posts it.

Example:
  ./thesimplekrew_crm.sh post "https://example.com/banner.jpg" "Hello from CRM!"
==============================================================================
EOF
  exit 1
}

CMD="${1:-}"

case "$CMD" in
  info)
    echo "[1/1] Fetching Account Info for @${TARGET_ACCOUNT}..."
    curl -s -X GET "${BASE_URL}/api/rest/me?account=${TARGET_ACCOUNT}" \
      -H "Authorization: Bearer ${API_KEY}" | jq . || cat
    echo ""
    ;;
  media)
    echo "[1/1] Fetching Recent Media for @${TARGET_ACCOUNT}..."
    curl -s -X GET "${BASE_URL}/api/rest/media?account=${TARGET_ACCOUNT}&limit=5" \
      -H "Authorization: Bearer ${API_KEY}" | jq . || cat
    echo ""
    ;;
  post)
    IMAGE_URL="${2:-}"
    CAPTION="${3:-}"
    if [[ -z "$IMAGE_URL" || -z "$CAPTION" ]]; then
      echo "ERROR: Missing image URL or caption."
      usage
    fi
    echo "[1/1] Publishing Photo to @${TARGET_ACCOUNT}..."
    curl -s -X POST "${BASE_URL}/api/rest/post" \
      -H "Authorization: Bearer ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"account\":\"${TARGET_ACCOUNT}\",\"image_url\":\"${IMAGE_URL}\",\"caption\":\"${CAPTION}\"}" | jq . || cat
    echo ""
    ;;
  generate)
    PROMPT="${2:-}"
    CAPTION="${3:-}"
    if [[ -z "$PROMPT" || -z "$CAPTION" ]]; then
      echo "ERROR: Missing prompt or caption."
      usage
    fi
    echo "[1/1] Generating AI Image and Posting to @${TARGET_ACCOUNT}..."
    curl -s -X POST "${BASE_URL}/api/rest/generate-and-post" \
      -H "Authorization: Bearer ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"account\":\"${TARGET_ACCOUNT}\",\"prompt\":\"${PROMPT}\",\"caption\":\"${CAPTION}\"}" | jq . || cat
    echo ""
    ;;
  *)
    usage
    ;;
esac
