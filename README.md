# Instagram MCP Platform — Multi-Account Studio & Server

Enterprise-grade Model Context Protocol (MCP) server and REST API for controlling **multiple Instagram Business and Creator accounts** from AI agents (Claude, Cursor, ChatGPT). Powered by **Vercel Serverless** and **Firebase Realtime Database**.

---

## Highlights

* **Multi-Account Support**: Connect and command unlimited Instagram Business/Creator accounts from a single MCP endpoint. Tools accept an optional `account` parameter (`username` or `ig_user_id`), automatically falling back to your designated active default account.
* **Modern Admin Panel (`/admin`)**: Sleek dark-mode dashboard to connect accounts, verify Meta tokens, inspect real-time token expiration, and switch default accounts.
* **Firebase Realtime Database**: Stores connected accounts, tokens, and per-account rate limit quotas safely.
* **Streamable HTTP MCP (`/mcp`)**: Stateless serverless endpoint with OAuth 2.1 authentication and RFC 8414 / RFC 9728 discovery for Claude Code, Cursor, and custom connectors.
* **19 Agentic Tools**: Feed posts, reels, stories, carousels, analytics/insights, follower demographics, optimal posting times, and AI image generation.
* **Automated Token Maintenance**: Vercel Cron runs every 30 days to auto-renew 60-day Meta tokens before they reach expiration.
* **Safety First**: All publishing actions default to `dry_run=true` to preview actions safely; rate limits are capped at 95 posts per rolling 24-hour window per account.

---

## Layout

```
Instagram_agent_mcp/
├── vercel/                   # Serverless platform root (deployable to Vercel)
│   ├── api/
│   │   ├── admin/            # Admin API (/api/admin/accounts)
│   │   ├── cron/             # Auto token refresh cron (/api/cron/refresh)
│   │   ├── oauth/            # OAuth 2.1 endpoints (authorize, token, register)
│   │   ├── rest/             # REST mirrors for Custom GPT actions
│   │   ├── mcp.ts            # Streamable HTTP MCP server handler (/mcp)
│   │   └── openapi.ts        # OpenAPI 3.1 specification (/api/openapi.json)
│   ├── lib/
│   │   ├── firebase.ts       # Firebase Realtime Database AccountStore
│   │   ├── tools.ts          # 19 MCP tool schemas and business logic
│   │   ├── ig.ts             # Instagram Graph API lifecycle & budget engine
│   │   ├── images.ts         # Free AI image generation (Pollinations / HF)
│   │   └── oauth.ts          # OAuth 2.1 server & JWT token handling
│   ├── public/
│   │   └── admin.html        # Interactive Admin Dashboard (/admin)
│   ├── tests/                # Vitest test suite (51 tests)
│   ├── package.json
│   └── vercel.json           # Rewrites, cron, and serverless timeout settings
├── docs/                     # Specifications and implementation plans
└── README.md
```

---

## 19 Available MCP Tools

| Category | Tools | Description |
|---|---|---|
| **Account Management** | `ig_list_accounts`, `ig_set_active_account`, `ig_me` | View connected accounts, change active default, verify credentials |
| **Publishing** | `ig_post`, `ig_reel`, `ig_story`, `ig_carousel_item`, `ig_carousel`, `ig_publish`, `ig_container_status` | Photos, reels, stories, multi-slide carousels (default `dry_run=true`) |
| **Analytics & Insights** | `ig_account_insights`, `ig_list_media`, `ig_media_insights`, `ig_audience_demographics`, `ig_best_posting_time` | Reach, views, engagement, demographics, optimal posting slots |
| **Engagement** | `ig_get_comments`, `ig_reply_comment` | Read and reply to comments on published media |
| **AI Generation** | `ig_generate_image`, `ig_generate_and_post` | Free image generation + direct-to-Instagram workflow |

---

## Quick Setup & Deployment

### 1. Deploy to Vercel
1. Import this repository in your Vercel Dashboard.
2. Set the **Root Directory** to `vercel`.
3. Add **KV** and **Blob** in the Vercel Storage tab (free tiers).

### 2. Environment Variables
Set the following in **Settings → Environment Variables**:

| Variable | Required | Description |
|---|---|---|
| `ADMIN_PASSWORD` | Yes | Password for Admin Panel (`/admin`) and OAuth login |
| `OAUTH_JWT_SECRET` | Yes | 32+ character random secret (`openssl rand -hex 32`) |
| `CRON_SECRET` | Yes | 32+ character secret for automated token refresh |
| `FIREBASE_DATABASE_URL` | No | Defaults to `https://insta-mcp-default-rtdb.asia-southeast1.firebasedatabase.app` |
| `FIREBASE_AUTH_SECRET` | No | Optional Database Secret for Firebase Realtime Database rules |
| `BRAND_STYLE` | No | Default visual style appended to AI image generation prompts |
| `HF_TOKEN` | No | Optional Hugging Face token for FLUX.1-schnell image generation |

### 3. Connect Accounts via Admin Panel
* Open `https://<your-project>.vercel.app/admin` in your browser.
* Enter your `ADMIN_PASSWORD` to unlock the dashboard.
* Click **+ Connect Account** and paste your Meta Long-Lived Token (from [Meta Developer Portal](https://developers.facebook.com/apps)).
* The platform automatically verifies the account against Meta's Graph API, extracts the username and ID, and stores it in Firebase Realtime Database.

---

## MCP Client Configuration

Connect from Claude, Cursor, or ChatGPT:

### Claude / Cursor (Streamable HTTP)
```json
{
  "mcpServers": {
    "instagram": {
      "url": "https://<your-project>.vercel.app/mcp"
    }
  }
}
```

### Example Multi-Account Prompts
```
# Target specific accounts
Use ig_post to publish an image with image_url="https://..." and account="brand_official", dry_run=false.

# Use default active account
Use ig_account_insights to view performance for the last 28 days.

# List all accounts
Use ig_list_accounts to show connected Instagram accounts and token status.

# Switch active default
Use ig_set_active_account to set "my_creator_page" as default.
```

---

## Disclaimer
Uses official Meta Instagram Graph API `v26.0` endpoints. Respects Meta rate limits and Terms of Service.
