// HTML pages: login/consent, seed-token form, home. Client-supplied strings
// are always escaped.

import { escapeHtml } from "./oauth";

export function loginPage(clientName: string, redirectHost: string, loopback: boolean, pendingId: string, scope: string[]): string {
  const name = escapeHtml(clientName);
  const scopes = scope.map((s) => `<li><code>${escapeHtml(s)}</code></li>`).join("");
  const warn = loopback
    ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>"
    : "";
  return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize ${name} — ig-mcp</title>
<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem}input,button{font-size:1rem;padding:.5rem}form>*{display:block;margin:.6rem 0;width:100%;box-sizing:border-box}.row{display:flex;gap:.6rem}.row>*{flex:1}</style>
<h1>Connect <em>${name}</em> to your Instagram MCP?</h1>
<p>Access will be sent to <strong>${escapeHtml(redirectHost)}</strong>.</p>
${warn}
<p>Scopes:</p><ul>${scopes}</ul>
<form method="post">
<input type="hidden" name="req" value="${escapeHtml(pendingId)}">
<label>Admin password <input type="password" name="password" autocomplete="current-password" required></label>
<div class="row"><button name="decision" value="approve" type="submit">Allow</button>
<button name="decision" value="deny" type="submit" formnovalidate>Deny</button></div>
</form>`;
}

export function errorPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>ig-mcp</title><body><p>${escapeHtml(message)}</p></body>`;
}

export function seedForm(): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Seed IG token — ig-mcp</title>
<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem}input,button{font-size:1rem;padding:.5rem}form>*{display:block;margin:.6rem 0;width:100%;box-sizing:border-box}</style>
<h1>Seed Instagram token</h1>
<p>Paste a long-lived Instagram user token. It is stored in KV, never logged, never echoed back.</p>
<form method="post">
<label>Admin password <input type="password" name="password" required></label>
<label>Long-lived token <input type="password" name="token" required></label>
<label>IG user id (optional — auto-detected) <input type="text" name="user_id"></label>
<button type="submit">Save</button></form>`;
}
