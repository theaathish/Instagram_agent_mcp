#!/usr/bin/env python3
"""ig-write MCP server — official Instagram Graph API for AI agents.

Wraps the `ig-write` CLI logic (same directory) as MCP tools over stdio.
Reuses ig-agent's stored token; no new login.

Setup:
  pip install mcp
  # Claude Code / Cursor / any MCP client (stdio):
  #   command: python3
  #   args: ["/path/to/ig-mcp-server.py"]

Tools: ig_me, ig_post, ig_reel, ig_story, ig_carousel_item, ig_carousel,
       ig_publish, ig_container_status, ig_delete, ig_like, ig_unlike.

Scopes (Instagram Login): post/reel/story/carousel -> content_publish;
like -> instagram_manage_engagement; delete -> instagram_manage_contents.
Notes has no official API and is intentionally absent.
"""
import importlib.machinery
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IG_WRITE_PATH = os.path.join(HERE, "ig-write")

if not os.path.exists(IG_WRITE_PATH):
    print(f"ERROR: ig-write not found next to server: {IG_WRITE_PATH}",
          file=sys.stderr)
    sys.exit(1)

_loader = importlib.machinery.SourceFileLoader("ig_write_core", IG_WRITE_PATH)
_spec = importlib.util.spec_from_loader("ig_write_core", _loader)
igw = importlib.util.module_from_spec(_spec)
_loader.exec_module(igw)

try:  # mcp 2.x: FastMCP renamed to MCPServer
    from mcp.server.mcpserver import MCPServer as FastMCP  # noqa: E402
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP  # noqa: E402

mcp = FastMCP("ig-write")


def _acct(account: str | None = None):
    acct = igw.load_account(None, account, None)
    igw.check_token_freshness(acct)
    return acct


def _ok(**kw):
    d = {"ok": True}
    d.update(kw)
    return json.dumps(d, ensure_ascii=False)


def _fail(exc: BaseException):
    msg = str(exc)
    return json.dumps({"ok": False, "error": msg}, ensure_ascii=False)


def _create_publish(fields: dict, kind: str, account=None,
                    poll_timeout=300, poll_interval=5):
    acct = _acct(account)
    cid = igw.create_container(acct, igw.DEFAULT_BASE,
                               igw.DEFAULT_API_VERSION, 60, **fields)
    if kind in ("reel", "carousel", "story-video", "post", "story"):
        try:
            igw.poll_container(acct, igw.DEFAULT_BASE, igw.DEFAULT_API_VERSION,
                               cid, 30 if kind == "post" else poll_timeout,
                               poll_interval, True)
        except SystemExit:
            pass  # photo status check is best-effort; publish anyway
    res = igw.publish_container(acct, igw.DEFAULT_BASE,
                                igw.DEFAULT_API_VERSION, cid, 60)
    return _ok(mode=kind, container_id=cid, media_id=res.get("id"))


@mcp.tool()
def ig_me(account: str | None = None) -> str:
    """Sanity check: show the active Instagram Business account (id, username)."""
    try:
        acct = _acct(account)
        res = igw.api_call("GET", "me",
                           {"fields": "id,username,account_type",
                            "access_token": acct["user_access_token"]},
                           igw.DEFAULT_BASE, igw.DEFAULT_API_VERSION, 60)
        return _ok(account=res)
    except (SystemExit, Exception) as e:
        return _fail(e)


@mcp.tool()
def ig_post(image_url: str, caption: str | None = None,
            account: str | None = None) -> str:
    """Publish a feed photo. image_url must be a PUBLIC https URL. Returns media_id."""
    try:
        return _create_publish({"image_url": image_url, "caption": caption},
                               "post", account, poll_timeout=30)
    except (SystemExit, Exception) as e:
        return _fail(e)


@mcp.tool()
def ig_reel(video_url: str, caption: str | None = None,
            cover_url: str | None = None,
            account: str | None = None) -> str:
    """Publish a reel. video_url must be a PUBLIC https URL. Returns media_id."""
    try:
        return _create_publish({"media_type": "REELS", "video_url": video_url,
                                "caption": caption, "cover_url": cover_url},
                               "reel", account)
    except (SystemExit, Exception) as e:
        return _fail(e)


@mcp.tool()
def ig_story(image_url: str | None = None, video_url: str | None = None,
             account: str | None = None) -> str:
    """Publish a story (pass image_url OR video_url, public https). Returns media_id."""
    try:
        if bool(image_url) == bool(video_url):
            return _fail(ValueError("pass exactly one of image_url / video_url"))
        if image_url:
            fields, kind = {"media_type": "STORIES", "image_url": image_url}, "story"
        else:
            fields, kind = {"media_type": "STORIES", "video_url": video_url}, "story-video"
        return _create_publish(fields, kind, account)
    except (SystemExit, Exception) as e:
        return _fail(e)


@mcp.tool()
def ig_carousel_item(image_url: str | None = None,
                     video_url: str | None = None,
                     account: str | None = None) -> str:
    """Create one carousel child container. Returns container_id for ig_carousel."""
    try:
        if bool(image_url) == bool(video_url):
            return _fail(ValueError("pass exactly one of image_url / video_url"))
        acct = _acct(account)
        fields = {"is_carousel_item": "true"}
        if image_url:
            fields["image_url"] = image_url
        else:
            fields.update({"video_url": video_url, "media_type": "REELS"})
        cid = igw.create_container(acct, igw.DEFAULT_BASE,
                                   igw.DEFAULT_API_VERSION, 60, **fields)
        return _ok(mode="carousel-item", container_id=cid)
    except (SystemExit, Exception) as e:
        return _fail(e)


@mcp.tool()
def ig_carousel(children: str, caption: str | None = None,
                account: str | None = None) -> str:
    """Publish a carousel from comma-separated child container ids. Returns media_id."""
    try:
        return _create_publish({"media_type": "CAROUSEL", "children": children,
                                "caption": caption}, "carousel", account)
    except (SystemExit, Exception) as e:
        return _fail(e)


@mcp.tool()
def ig_publish(creation_id: str, account: str | None = None) -> str:
    """Publish an existing (FINISHED) container id. Returns media_id."""
    try:
        acct = _acct(account)
        res = igw.publish_container(acct, igw.DEFAULT_BASE,
                                    igw.DEFAULT_API_VERSION, creation_id, 60)
        return _ok(mode="publish", media_id=res.get("id"))
    except (SystemExit, Exception) as e:
        return _fail(e)


@mcp.tool()
def ig_container_status(container_id: str,
                        account: str | None = None) -> str:
    """Check a container's status_code (IN_PROGRESS / FINISHED / ERROR)."""
    try:
        acct = _acct(account)
        res = igw.api_call("GET", str(container_id),
                           {"fields": "status_code,status",
                            "access_token": acct["user_access_token"]},
                           igw.DEFAULT_BASE, igw.DEFAULT_API_VERSION, 30)
        return _ok(container_id=container_id, **res)
    except (SystemExit, Exception) as e:
        return _fail(e)


@mcp.tool()
def ig_delete(media_id: str, account: str | None = None) -> str:
    """Delete a post/reel/story. Needs instagram_manage_contents scope."""
    try:
        acct = _acct(account)
        igw.require_scope(acct, igw.SCOPE_HINTS["delete"])
        res = igw.api_call("DELETE", str(media_id),
                           {"access_token": acct["user_access_token"]},
                           igw.DEFAULT_BASE, igw.DEFAULT_API_VERSION, 60)
        return _ok(mode="delete", media_id=media_id, result=res)
    except (SystemExit, Exception) as e:
        return _fail(e)


@mcp.tool()
def ig_like(media_id: str | None = None, comment_id: str | None = None,
            account: str | None = None) -> str:
    """Like a media or comment. Needs instagram_manage_engagement (Apr 2026 API)."""
    try:
        if bool(media_id) == bool(comment_id):
            return _fail(ValueError("pass exactly one of media_id / comment_id"))
        acct = _acct(account)
        igw.require_scope(acct, igw.SCOPE_HINTS["engagement"])
        target = {"media_id": media_id} if media_id else {"comment_id": comment_id}
        params = dict(target)
        params["access_token"] = acct["user_access_token"]
        res = igw.api_call("POST", f"{acct['ig_user_id']}/likes", params,
                           igw.DEFAULT_BASE, igw.DEFAULT_API_VERSION, 60)
        return _ok(mode="like", **target, result=res)
    except (SystemExit, Exception) as e:
        return _fail(e)


@mcp.tool()
def ig_unlike(media_id: str | None = None, comment_id: str | None = None,
              account: str | None = None) -> str:
    """Unlike a media or comment."""
    try:
        if bool(media_id) == bool(comment_id):
            return _fail(ValueError("pass exactly one of media_id / comment_id"))
        acct = _acct(account)
        igw.require_scope(acct, igw.SCOPE_HINTS["engagement"])
        target = {"media_id": media_id} if media_id else {"comment_id": comment_id}
        params = dict(target)
        params["access_token"] = acct["user_access_token"]
        res = igw.api_call("DELETE", f"{acct['ig_user_id']}/likes", params,
                           igw.DEFAULT_BASE, igw.DEFAULT_API_VERSION, 60)
        return _ok(mode="unlike", **target, result=res)
    except (SystemExit, Exception) as e:
        return _fail(e)


if __name__ == "__main__":
    mcp.run()
