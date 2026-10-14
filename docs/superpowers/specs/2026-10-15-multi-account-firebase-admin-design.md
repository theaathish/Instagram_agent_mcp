# Multi-Account Instagram MCP Server with Firebase & Admin Panel

## 1. Overview
Transform the single-account Instagram MCP server into an enterprise-ready, multi-account platform powered by Firebase and Vercel. AI agents (via MCP or REST) can target any connected Instagram account or use a designated default account. An administrator dashboard hosted at `/admin` enables secure authentication, connection of unlimited Instagram Business/Creator accounts (via direct token verification or OAuth), monitoring of token health, and rate limit visibility.

## 2. Firebase Configuration & Data Model

### Firebase Project Details
- **Project ID**: `insta-mcp`
- **Auth Domain**: `insta-mcp.firebaseapp.com`
- **Database URL**: `https://insta-mcp-default-rtdb.asia-southeast1.firebasedatabase.app`
- **Storage Bucket**: `insta-mcp.firebasestorage.app`
- **App ID**: `1:820136583492:web:7a7fd300dbea5a0feb3711`

### Realtime Database Schema (`/accounts` & `/settings`)
```json
{
  "accounts": {
    "<ig_user_id>": {
      "ig_user_id": "string",
      "username": "string",
      "account_type": "BUSINESS | CREATOR",
      "access_token": "string",
      "token_expires_at": 1740000000,
      "granted_scopes": [
        "instagram_business_basic",
        "instagram_business_content_publish",
        "instagram_business_manage_insights",
        "instagram_business_manage_comments"
      ],
      "is_default": true,
      "brand_style": "string (optional)",
      "profile_picture_url": "string (optional)",
      "publish_budget": {
        "count_24h": 0,
        "window_start": 1739500000
      },
      "connected_at": 1739000000,
      "last_refreshed_at": 1739000000,
      "status": "active"
    }
  },
  "settings": {
    "active_account_id": "<ig_user_id>"
  }
}
```

## 3. Admin Panel (`/admin`)

### Architecture
- Served at `/admin` (rewritten to `/api/admin/dashboard` or static HTML in `/public/admin.html`).
- Built with HTML, Vanilla CSS (rich dark aesthetic, `#09090b` zinc background, glassmorphism card borders, vibrant status pills), and Firebase Client SDK v10+.
- Supports Firebase Authentication (Email/Password & Google Sign-In) to gate dashboard access.

### Features
1. **Authentication Card**: Sign-in / Sign-up for the admin user.
2. **Account Inventory**:
   - Lists all connected Instagram accounts.
   - Shows avatar, username, account type badge, and active/default indicator.
   - Displays real-time token expiry countdown with warning highlights if < 14 days remain.
   - Shows rolling 24-hour publish limit gauge (e.g. `12 / 95 published`).
   - Quick action buttons: **Set Active / Default**, **Validate / Test**, **Refresh Token Now**, **Disconnect Account**.
3. **Connect Account Modal**:
   - **Direct Token Input**: Input for Meta Long-Lived Token + optional Brand Style prompt. Clicking "Verify & Connect" queries Meta's `/me` endpoint to extract `id`, `username`, and `account_type`, validating scopes and recording to Firebase.
   - **OAuth Connect**: Launch Instagram Login OAuth flow.

## 4. MCP Server & Tool Multi-Account Routing

### Serverless Backend
- The Vercel MCP server integrates Firebase Realtime Database for credential retrieval, account lookup, and budget tracking.
- Fallback support: If an account is not found in Firebase, it can fall back to environment variables (`IG_USER_ID`, `IG_LONG_LIVED_TOKEN`) for backward compatibility.

### Multi-Account Parameters & Tool Additions
1. **Existing Tools** (`ig_me`, `ig_post`, `ig_reel`, `ig_story`, `ig_carousel_item`, `ig_carousel`, `ig_publish`, `ig_container_status`, `ig_account_insights`, `ig_list_media`, `ig_media_insights`, `ig_get_comments`, `ig_reply_comment`, `ig_audience_demographics`, `ig_best_posting_time`, `ig_generate_image`, `ig_generate_and_post`):
   - Added parameter: `account?: string` (matches either `username` without `@` or numeric `ig_user_id`).
   - If `account` is provided, the server resolves that specific account from Firebase. If omitted, it automatically uses the account where `is_default === true` (or `settings.active_account_id`).
2. **New MCP Tools**:
   - `ig_list_accounts`: Returns an array of connected accounts (`[{ ig_user_id, username, account_type, is_default, status, token_expires_days }]`).
   - `ig_set_active_account`: Sets the default active account for subsequent calls when no account parameter is passed.

### Publish Budget Tracking
- Budget tracking (95 publishes / rolling 24-hour window) is partitioned per account ID in Firebase Realtime Database (`accounts/<id>/publish_budget`).

## 5. Token Maintenance & Vercel Cron
- `/api/cron/refresh`:
  - Triggered every 30 days by Vercel Cron (`0 8 */30 * *`), protected by `CRON_SECRET`.
  - Iterates through all connected accounts in Firebase Realtime Database.
  - Refreshes tokens that have `< 35` days until expiration via Meta's `GET /refresh_access_token` endpoint.
  - Updates `token_expires_at` and `last_refreshed_at` in Firebase.

## 6. Cleanup of Local Implementation
- Delete the legacy single-account local Python files:
  - `ig-write`
  - `ig-mcp-server.py`
  - `test_ig_write.py`
  - `requirements.txt`
  - Root `__pycache__/`
- Update `README.md` to reflect the multi-account architecture, Firebase configuration, Admin Panel access, and tool documentation.
