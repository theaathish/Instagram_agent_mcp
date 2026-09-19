# Instagram_agent_mcp

Official-API Instagram writer for humans **and** AI agents. No API key — it reuses
[`ig-agent`](https://github.com/PixelFred0/ig-agent-cli)'s stored long-lived token.

Two entry points, one logic core:

| File | What |
|---|---|
| `ig-write` | Zero-dependency Python CLI (stdlib only). Post / reel / story / carousel / delete / like |
| `ig-mcp-server.py` | MCP stdio server wrapping `ig-write` — 11 tools for agentic mode (Claude Code, Cursor, …) |

## Prereqs

- Python 3.10+
- An Instagram **Business/Creator** account connected via `ig-agent`:
  ```bash
  npm install -g ig-agent
  ig-agent auth login     # or: ig-agent auth exchange --redirect-uri ... --code ...
  ig-agent auth status    # check granted scopes
  ```
- For MCP mode: `pip install -r requirements.txt`

## Scopes

| Action | Scope |
|---|---|
| post / reel / story / carousel | `instagram_business_content_publish` |
| like / unlike | `instagram_manage_engagement` (Apr 2026 Like API) |
| delete | `instagram_manage_contents` (Dec 2025 Delete API) |

`ig-write me` + `ig-write <cmd>` surface a clear re-auth hint when a scope is missing.
**Notes has no official Meta API** and is intentionally not included.

## CLI usage

```bash
./ig-write me
./ig-write post --image-url https://example.com/pic.jpg --caption "hello"
./ig-write reel --video-url https://example.com/clip.mp4 --caption "hi"
./ig-write story --image-url https://example.com/pic.jpg
./ig-write story --video-url https://example.com/clip.mp4
./ig-write carousel-item --image-url https://example.com/a.jpg   # -> container id
./ig-write carousel --children CID1,CID2 --caption "swipe"
./ig-write publish --creation-id <container_id>
./ig-write status --container-id <container_id>
./ig-write delete --media-id <media_id>
./ig-write like --media-id <id>
./ig-write unlike --comment-id <id>
```

Media must be on a **public https URL**. Flow per command:
create container → poll `status_code=FINISHED` → `media_publish`.
`--container-only` stops after step 1 (container expires in 24 h).
Limits: ~100 API publishes / rolling 24 h.

## MCP (agentic mode)

```bash
pip install -r requirements.txt
```

Client config (stdio):

```json
{
  "mcpServers": {
    "ig-write": {
      "command": "python3",
      "args": ["/path/to/Instagram_agent_mcp/ig-mcp-server.py"]
    }
  }
}
```

Tools: `ig_me, ig_post, ig_reel, ig_story, ig_carousel_item, ig_carousel,
ig_publish, ig_container_status, ig_delete, ig_like, ig_unlike`.
The token is read from your local ig-agent config — no extra login.

## Layout

```
Instagram_agent_mcp/
├── ig-write           # CLI (stdlib only, executable)
├── ig-mcp-server.py   # MCP server (needs: pip install mcp)
├── requirements.txt
├── README.md
└── LICENSE
```

## Disclaimer

Uses Meta's official Instagram Graph API only. Media URLs must be public;
respect Meta's rate limits and ToS — this is for your own accounts, not for
serving end-user generation. Tested against `graph.instagram.com v26.0`.
