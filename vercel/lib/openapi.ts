// Minimal OpenAPI 3.1 for the /api/rest/* mirrors (Custom GPT Actions).

export function buildOpenApi(origin: string): Record<string, unknown> {
  const dryRun = {
    type: "boolean",
    default: true,
    description: "Preview only when true/omitted; real publishing only when explicitly false.",
  };
  const base = `${origin}/api/rest`;
  return {
    openapi: "3.1.0",
    info: {
      title: "ig-mcp Instagram API",
      version: "1.0.0",
      description:
        "Publish and analyse an Instagram Business account via the official Graph API. All write operations default to dry_run=true (preview); set dry_run=false to publish for real.",
    },
    servers: [{ url: base }],
    security: [{ oauth2: [] }],
    components: {
      securitySchemes: {
        oauth2: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: `${origin}/api/oauth/authorize`,
              tokenUrl: `${origin}/api/oauth/token`,
              scopes: { "ig:read": "read account data", "ig:write": "publish content" },
            },
          },
        },
      },
    },
    paths: {
      "/account": {
        get: { operationId: "getAccount", summary: "Show the active Instagram Business account.", responses: { "200": { description: "Account info" } } },
      },
      "/media": {
        get: {
          operationId: "listMedia",
          summary: "List recent media with caption, permalink, timestamp, counts.",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 25 } }],
          responses: { "200": { description: "Media list" } },
        },
      },
      "/media/{media_id}/insights": {
        get: {
          operationId: "mediaInsights",
          summary: "Per-media insights (reach, saved, shares, views, total_interactions).",
          parameters: [{ name: "media_id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Insights" } },
        },
      },
      "/generate-image": {
        post: {
          operationId: "generateImage",
          summary: "Generate an image and return a public https URL.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["prompt"],
                  properties: {
                    prompt: { type: "string" },
                    aspect: { type: "string", enum: ["1:1", "4:5", "9:16"], default: "1:1" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Image URL" } },
        },
      },
      "/post": {
        post: {
          operationId: "publishPhoto",
          summary: "Publish a feed photo from a public https image URL.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["image_url"],
                  properties: { image_url: { type: "string", format: "uri" }, caption: { type: "string" }, dry_run: dryRun },
                },
              },
            },
          },
          responses: { "200": { description: "Publish result or dry-run preview" } },
        },
      },
      "/generate-and-post": {
        post: {
          operationId: "generateAndPost",
          summary: "Generate an image and post it (dry_run default true = preview only).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["prompt"],
                  properties: {
                    prompt: { type: "string" },
                    caption: { type: "string" },
                    aspect: { type: "string", enum: ["1:1", "4:5", "9:16"], default: "1:1" },
                    dry_run: dryRun,
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Result or preview" } },
        },
      },
    },
  };
}
