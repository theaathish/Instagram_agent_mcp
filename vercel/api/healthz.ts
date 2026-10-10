// GET /api/healthz — zero-dependency diagnostics (no imports from lib/).

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({
    ok: true,
    service: "ig-mcp",
    node: process.version,
    time: new Date().toISOString(),
    env: {
      adminPassword: !!process.env.ADMIN_PASSWORD,
      igUserId: !!process.env.IG_USER_ID,
      igSeedToken: !!process.env.IG_LONG_LIVED_TOKEN,
      oauthJwtSecret: !!process.env.OAUTH_JWT_SECRET,
      cronSecret: !!process.env.CRON_SECRET,
      kv: !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
      blob: !!process.env.BLOB_READ_WRITE_TOKEN,
    },
  });
}
