#!/usr/bin/env python3
"""sc — shuvcrawl CLI wrapper. Zero-dependency Python CLI for the shuvcrawl REST API."""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

VERSION = "0.1.0"
REPO_DIR = Path(__file__).resolve().parent
DEFAULT_API_URL = "http://localhost:3777"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _resolve_token(args):
    """Resolve API token: --token flag > env > .env file in repo > .env in cwd."""
    if getattr(args, "token", None):
        return args.token
    if os.environ.get("SHUVCRAWL_API_TOKEN"):
        return os.environ["SHUVCRAWL_API_TOKEN"]
    for env_path in [REPO_DIR / ".env", Path.cwd() / ".env"]:
        if env_path.is_file():
            try:
                for line in env_path.read_text().splitlines():
                    line = line.strip()
                    if line.startswith("SHUVCRAWL_API_TOKEN="):
                        val = line.split("=", 1)[1].strip().strip("'\"")
                        if val:
                            return val
            except OSError:
                pass
    return None


def _resolve_api_url(args):
    """Resolve API URL: --api-url flag > env > default."""
    if getattr(args, "api_url", None):
        return args.api_url.rstrip("/")
    return os.environ.get("SHUVCRAWL_API_URL", DEFAULT_API_URL).rstrip("/")


def _api(method, url, token=None, body=None, timeout=120):
    """Make an HTTP request and return parsed JSON."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            err_body = json.loads(e.read().decode())
        except Exception:
            err_body = None
        if err_body and "error" in err_body:
            err = err_body["error"]
            code = err.get("code", e.code)
            msg = err.get("message", str(e))
            _err(f"[{code}] {msg}")
        else:
            _err(f"HTTP {e.code}: {e.reason}")
    except urllib.error.URLError as e:
        _err(f"Connection failed: {e.reason}\nIs shuvcrawl running? Try: sc up")
    except TimeoutError:
        _err("Request timed out")


def _err(msg):
    print(f"Error {msg}", file=sys.stderr)
    sys.exit(1)


def _print_json(data):
    print(json.dumps(data, indent=2, ensure_ascii=False))


# ── Commands ─────────────────────────────────────────────────────────────────

def cmd_health(args):
    url = _resolve_api_url(args)
    token = _resolve_token(args)
    data = _api("GET", f"{url}/health", token=token, timeout=10)
    if args.json:
        _print_json(data)
        return
    ok = data.get("ok", False)
    status = "OK" if ok else "UNHEALTHY"
    print(f"shuvcrawl: {status}")
    bpc = data.get("bpc", {})
    if bpc:
        print(f"  BPC: v{bpc.get('version', '?')} ({bpc.get('sourceMode', '?')})")
    browser = data.get("browser", {})
    if browser:
        print(f"  Browser: {browser.get('executablePath', '?')} (headless={browser.get('headless', '?')})")
    cfg = data.get("config", {})
    api_cfg = cfg.get("api", {})
    print(f"  Port: {api_cfg.get('port', '?')}")
    print(f"  Auth: {'enabled' if api_cfg.get('hasToken') else 'disabled'}")
    cache = cfg.get("cache", {})
    print(f"  Cache: {'on' if cache.get('enabled') else 'off'} (TTL {cache.get('ttl', '?')}s)")


def cmd_config(args):
    url = _resolve_api_url(args)
    token = _resolve_token(args)
    data = _api("GET", f"{url}/config", token=token, timeout=10)
    _print_json(data)


def cmd_scrape(args):
    url = _resolve_api_url(args)
    token = _resolve_token(args)

    options = {}
    if args.wait:
        options["wait"] = args.wait
    if args.wait_for:
        options["waitFor"] = args.wait_for
    if args.wait_timeout:
        options["waitTimeout"] = args.wait_timeout
    if args.sleep:
        options["sleep"] = args.sleep
    if args.selector:
        options["selector"] = args.selector
    if args.raw_html:
        options["rawHtml"] = True
    if args.no_main_content:
        options["onlyMainContent"] = False
    else:
        options["onlyMainContent"] = True
    if args.no_fast_path:
        options["noFastPath"] = True
    if args.no_bpc:
        options["noBpc"] = True
    if args.no_cache:
        options["noCache"] = True
    if args.mobile:
        options["mobile"] = True
    if args.debug_artifacts:
        options["debugArtifacts"] = True
    if args.header:
        hdrs = {}
        for h in args.header:
            if "=" in h:
                k, v = h.split("=", 1)
                hdrs[k.strip()] = v.strip()
        if hdrs:
            options["headers"] = hdrs

    body = {"url": args.url}
    if options:
        body["options"] = options

    data = _api("POST", f"{url}/scrape", token=token, body=body, timeout=90)

    if args.json:
        _print_json(data)
        return

    if not data.get("success", True):
        err = data.get("error", {})
        _err(f"[{err.get('code', '?')}] {err.get('message', 'Scrape failed')}")

    d = data.get("data", {})
    content = d.get("content", "")
    meta = d.get("metadata", {})

    if not content:
        status = meta.get("status", "unknown")
        print(f"No content extracted (status: {status})", file=sys.stderr)
        if meta.get("extractionMethod") == "fullbody":
            print("Hint: page may be behind a CAPTCHA or paywall", file=sys.stderr)
        sys.exit(1)

    # Build header
    title = meta.get("title", "")
    parts = []
    if meta.get("author"):
        parts.append(meta["author"])
    if meta.get("publishedAt"):
        parts.append(f"Published: {meta['publishedAt']}")
    wc = meta.get("wordCount", 0)
    if wc:
        parts.append(f"{wc:,} words")
    method = meta.get("extractionMethod")
    if method:
        parts.append(f"method: {method}")

    output_lines = []
    if title:
        output_lines.append(f"# {title}\n")
    if parts:
        output_lines.append(f"> {' | '.join(parts)}\n")
    output_lines.append(content)
    output_text = "\n".join(output_lines)

    if args.output:
        Path(args.output).write_text(output_text, encoding="utf-8")
        print(f"Saved to {args.output}", file=sys.stderr)
    else:
        print(output_text)


def cmd_map(args):
    url = _resolve_api_url(args)
    token = _resolve_token(args)

    options = {}
    if args.source:
        options["source"] = args.source
    if args.include:
        options["include"] = args.include
    if args.exclude:
        options["exclude"] = args.exclude
    if args.no_same_origin:
        options["sameOriginOnly"] = False
    if args.no_fast_path:
        options["noFastPath"] = True
    if args.no_bpc:
        options["noBpc"] = True
    if args.wait:
        options["wait"] = args.wait

    body = {"url": args.url}
    if options:
        body["options"] = options

    data = _api("POST", f"{url}/map", token=token, body=body, timeout=60)

    if args.json:
        _print_json(data)
        return

    if not data.get("success", True):
        err = data.get("error", {})
        _err(f"[{err.get('code', '?')}] {err.get('message', 'Map failed')}")

    d = data.get("data", {})
    discovered = d.get("discovered", d.get("urls", []))
    urls = [item["url"] if isinstance(item, dict) else item for item in discovered]
    # Deduplicate preserving order
    seen = set()
    unique = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            unique.append(u)
    print(f"Found {len(unique)} URLs:", file=sys.stderr)
    for u in unique:
        print(u)


def cmd_crawl(args):
    url = _resolve_api_url(args)
    token = _resolve_token(args)

    options = {}
    if args.depth is not None:
        options["depth"] = args.depth
    if args.limit is not None:
        options["limit"] = args.limit
    if args.delay is not None:
        options["delay"] = args.delay
    if args.source:
        options["source"] = args.source
    if args.include:
        options["include"] = args.include
    if args.exclude:
        options["exclude"] = args.exclude
    if args.resume:
        options["resume"] = True
    if args.no_fast_path:
        options["noFastPath"] = True
    if args.no_bpc:
        options["noBpc"] = True
    if args.no_cache:
        options["noCache"] = True
    if args.debug_artifacts:
        options["debugArtifacts"] = True
    if args.wait:
        options["wait"] = args.wait

    body = {"url": args.url}
    if options:
        body["options"] = options

    data = _api("POST", f"{url}/crawl", token=token, body=body, timeout=30)

    if args.json and not args.poll:
        _print_json(data)
        return

    job = data.get("job", data.get("data", {}))
    job_id = job.get("jobId", job.get("id", ""))
    if not job_id:
        _err("No jobId returned from crawl")

    if not args.poll:
        print(f"Crawl started: {job_id}")
        print(f"Check status: sc crawl-status {job_id}")
        print(f"Cancel:       sc crawl-cancel {job_id}")
        return

    # Poll loop
    print(f"Crawl started: {job_id}", file=sys.stderr)
    limit = args.limit or 50
    interval = args.poll_interval or 5
    start = time.time()

    while True:
        time.sleep(interval)
        status_data = _api("GET", f"{url}/crawl/{job_id}", token=token, timeout=15)
        job_status = status_data.get("status", status_data.get("data", {}).get("status", ""))
        completed = status_data.get("completedCount", status_data.get("data", {}).get("completedCount", 0))

        bar_len = 30
        filled = int(bar_len * completed / max(limit, 1))
        bar = "█" * filled + "░" * (bar_len - filled)
        pct = int(100 * completed / max(limit, 1))
        elapsed = int(time.time() - start)
        print(f"\r  [{bar}] {completed}/{limit} pages ({pct}%) {elapsed}s", end="", file=sys.stderr, flush=True)

        if job_status in ("completed", "failed", "cancelled"):
            print(file=sys.stderr)
            if job_status == "completed":
                print(f"Done: {completed} pages crawled in {elapsed}s", file=sys.stderr)
            elif job_status == "failed":
                print(f"Crawl failed after {completed} pages", file=sys.stderr)
            else:
                print(f"Crawl cancelled after {completed} pages", file=sys.stderr)

            if args.json:
                _print_json(status_data)
            break

    return


def cmd_crawl_status(args):
    url = _resolve_api_url(args)
    token = _resolve_token(args)
    data = _api("GET", f"{url}/crawl/{args.job_id}", token=token, timeout=15)
    if args.json:
        _print_json(data)
        return
    status = data.get("status", data.get("data", {}).get("status", "unknown"))
    completed = data.get("completedCount", data.get("data", {}).get("completedCount", 0))
    total = data.get("totalCount", data.get("data", {}).get("totalCount", "?"))
    print(f"Job:    {args.job_id}")
    print(f"Status: {status}")
    print(f"Pages:  {completed}/{total}")


def cmd_crawl_cancel(args):
    url = _resolve_api_url(args)
    token = _resolve_token(args)
    data = _api("DELETE", f"{url}/crawl/{args.job_id}", token=token, timeout=15)
    if args.json:
        _print_json(data)
        return
    print(f"Cancelled: {args.job_id}")


def cmd_screenshot(args):
    url = _resolve_api_url(args)
    token = _resolve_token(args)

    options = {}
    if args.full_page:
        options["fullPage"] = True
    if args.wait:
        options["wait"] = args.wait
    if args.wait_for:
        options["waitFor"] = args.wait_for
    if args.wait_timeout:
        options["waitTimeout"] = args.wait_timeout
    if args.sleep:
        options["sleep"] = args.sleep

    body = {"url": args.url}
    if options:
        body["options"] = options

    data = _api("POST", f"{url}/screenshot", token=token, body=body, timeout=60)

    if args.json:
        _print_json(data)
        return

    if not data.get("success", True):
        err = data.get("error", {})
        _err(f"[{err.get('code', '?')}] {err.get('message', 'Screenshot failed')}")

    d = data.get("data", {})
    artifacts = d.get("artifacts", {})
    screenshot_path = artifacts.get("screenshot", "")

    if args.output and screenshot_path:
        # Copy from container output dir
        src = REPO_DIR / screenshot_path
        if src.exists():
            import shutil
            shutil.copy2(src, args.output)
            print(f"Saved to {args.output}", file=sys.stderr)
        else:
            print(f"Artifact: {screenshot_path}")
            print(f"(file at {src} not found locally — may be inside Docker volume)", file=sys.stderr)
    elif screenshot_path:
        print(f"Screenshot: {screenshot_path}")
    else:
        print("Screenshot captured (check artifacts dir)")


def cmd_pdf(args):
    url = _resolve_api_url(args)
    token = _resolve_token(args)

    options = {}
    if args.format:
        options["format"] = args.format
    if args.landscape:
        options["landscape"] = True
    if args.wait:
        options["wait"] = args.wait

    body = {"url": args.url}
    if options:
        body["options"] = options

    data = _api("POST", f"{url}/pdf", token=token, body=body, timeout=60)

    if args.json:
        _print_json(data)
        return

    if not data.get("success", True):
        err = data.get("error", {})
        _err(f"[{err.get('code', '?')}] {err.get('message', 'PDF failed')}")

    d = data.get("data", {})
    artifacts = d.get("artifacts", {})
    pdf_path = artifacts.get("pdf", "")

    if args.output and pdf_path:
        src = REPO_DIR / pdf_path
        if src.exists():
            import shutil
            shutil.copy2(src, args.output)
            print(f"Saved to {args.output}", file=sys.stderr)
        else:
            print(f"Artifact: {pdf_path}")
            print(f"(file at {src} not found locally — may be inside Docker volume)", file=sys.stderr)
    elif pdf_path:
        print(f"PDF: {pdf_path}")
    else:
        print("PDF captured (check artifacts dir)")


def cmd_up(args):
    print("Starting shuvcrawl...", file=sys.stderr)
    r = subprocess.run(
        ["docker", "compose", "up", "-d", "--build"],
        cwd=str(REPO_DIR),
    )
    if r.returncode == 0:
        # Wait for health
        api_url = _resolve_api_url(args)
        token = _resolve_token(args)
        for i in range(20):
            time.sleep(2)
            try:
                _api("GET", f"{api_url}/health", token=token, timeout=5)
                print("shuvcrawl is ready!", file=sys.stderr)
                return
            except SystemExit:
                pass
        print("Started, but health check not yet passing", file=sys.stderr)
    sys.exit(r.returncode)


def cmd_down(args):
    r = subprocess.run(
        ["docker", "compose", "down"],
        cwd=str(REPO_DIR),
    )
    sys.exit(r.returncode)


def cmd_logs(args):
    try:
        subprocess.run(
            ["docker", "compose", "logs", "-f", "--tail=100"],
            cwd=str(REPO_DIR),
        )
    except KeyboardInterrupt:
        pass


# ── Parser ───────────────────────────────────────────────────────────────────

def build_parser():
    p = argparse.ArgumentParser(
        prog="sc",
        description="shuvcrawl CLI wrapper — scrape, map, crawl, screenshot, PDF",
    )
    p.add_argument("--api-url", help="API base URL (default: $SHUVCRAWL_API_URL or http://localhost:3777)")
    p.add_argument("--token", help="API bearer token (default: $SHUVCRAWL_API_TOKEN)")
    p.add_argument("--json", action="store_true", help="Output raw JSON response")
    p.add_argument("--version", action="version", version=f"sc {VERSION}")

    sub = p.add_subparsers(dest="command", metavar="command")

    # health
    sub.add_parser("health", help="Check service health")

    # config
    sub.add_parser("config", help="Show running server config")

    # scrape
    sp = sub.add_parser("scrape", help="Scrape a single page")
    sp.add_argument("url", help="URL to scrape")
    sp.add_argument("--wait", choices=["load", "networkidle", "selector", "sleep"], help="Wait strategy")
    sp.add_argument("--wait-for", help="CSS selector to wait for")
    sp.add_argument("--wait-timeout", type=int, help="Wait timeout in ms")
    sp.add_argument("--sleep", type=int, help="Sleep ms after page load")
    sp.add_argument("--selector", help="CSS selector to scope extraction")
    sp.add_argument("--raw-html", action="store_true", help="Include raw HTML")
    sp.add_argument("--no-main-content", action="store_true", help="Extract full page instead of main content")
    sp.add_argument("--no-fast-path", action="store_true", help="Force browser rendering")
    sp.add_argument("--no-bpc", action="store_true", help="Disable Bypass Paywalls Clean")
    sp.add_argument("--no-cache", action="store_true", help="Bypass cache")
    sp.add_argument("--mobile", action="store_true", help="Emulate mobile viewport")
    sp.add_argument("--debug-artifacts", action="store_true", help="Save debug artifacts")
    sp.add_argument("--header", action="append", metavar="KEY=VALUE", help="Custom header (repeatable)")
    sp.add_argument("-o", "--output", help="Write content to file")

    # map
    mp = sub.add_parser("map", help="Discover URLs from a page or sitemap")
    mp.add_argument("url", help="URL to map")
    mp.add_argument("--source", choices=["links", "sitemap", "both"], help="URL source (default: both)")
    mp.add_argument("--include", action="append", metavar="PATTERN", help="Include URL glob (repeatable)")
    mp.add_argument("--exclude", action="append", metavar="PATTERN", help="Exclude URL glob (repeatable)")
    mp.add_argument("--no-same-origin", action="store_true", help="Allow cross-origin URLs")
    mp.add_argument("--no-fast-path", action="store_true", help="Force browser rendering")
    mp.add_argument("--no-bpc", action="store_true", help="Disable BPC")
    mp.add_argument("--wait", choices=["load", "networkidle", "selector", "sleep"], help="Wait strategy")

    # crawl
    cp = sub.add_parser("crawl", help="Start async multi-page crawl")
    cp.add_argument("url", help="Starting URL")
    cp.add_argument("--depth", type=int, help="Max crawl depth (default: 3)")
    cp.add_argument("--limit", type=int, help="Max pages (default: 50)")
    cp.add_argument("--delay", type=int, help="Per-domain delay ms (default: 1000)")
    cp.add_argument("--source", choices=["links", "sitemap", "both"], help="URL source")
    cp.add_argument("--include", action="append", metavar="PATTERN", help="Include URL glob (repeatable)")
    cp.add_argument("--exclude", action="append", metavar="PATTERN", help="Exclude URL glob (repeatable)")
    cp.add_argument("--resume", action="store_true", help="Resume previous crawl")
    cp.add_argument("--no-fast-path", action="store_true", help="Force browser rendering")
    cp.add_argument("--no-bpc", action="store_true", help="Disable BPC")
    cp.add_argument("--no-cache", action="store_true", help="Bypass cache")
    cp.add_argument("--debug-artifacts", action="store_true", help="Save debug artifacts")
    cp.add_argument("--wait", choices=["load", "networkidle", "selector", "sleep"], help="Wait strategy")
    cp.add_argument("--poll", action="store_true", help="Poll until job completes")
    cp.add_argument("--poll-interval", type=int, default=5, help="Poll interval seconds (default: 5)")

    # crawl-status
    cs = sub.add_parser("crawl-status", help="Check crawl job status")
    cs.add_argument("job_id", help="Job ID")

    # crawl-cancel
    cc = sub.add_parser("crawl-cancel", help="Cancel a crawl job")
    cc.add_argument("job_id", help="Job ID")

    # screenshot
    ss = sub.add_parser("screenshot", help="Capture a screenshot")
    ss.add_argument("url", help="URL to capture")
    ss.add_argument("--full-page", action="store_true", help="Capture full page")
    ss.add_argument("--wait", choices=["load", "networkidle", "selector", "sleep"], help="Wait strategy")
    ss.add_argument("--wait-for", help="CSS selector to wait for")
    ss.add_argument("--wait-timeout", type=int, help="Wait timeout in ms")
    ss.add_argument("--sleep", type=int, help="Sleep ms after page load")
    ss.add_argument("-o", "--output", help="Save screenshot to file")

    # pdf
    pp = sub.add_parser("pdf", help="Render page as PDF")
    pp.add_argument("url", help="URL to render")
    pp.add_argument("--format", choices=["A4", "Letter", "Legal", "Tabloid"], help="Page format (default: A4)")
    pp.add_argument("--landscape", action="store_true", help="Landscape orientation")
    pp.add_argument("--wait", choices=["load", "networkidle", "selector", "sleep"], help="Wait strategy")
    pp.add_argument("-o", "--output", help="Save PDF to file")

    # docker helpers
    sub.add_parser("up", help="Start shuvcrawl in Docker")
    sub.add_parser("down", help="Stop shuvcrawl Docker container")
    sub.add_parser("logs", help="Tail shuvcrawl Docker logs")

    return p


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = build_parser()
    args, remaining = parser.parse_known_args()

    # Allow --json after subcommand
    if "--json" in remaining:
        args.json = True
        remaining.remove("--json")
    if remaining:
        parser.error(f"unrecognized arguments: {' '.join(remaining)}")

    if not args.command:
        parser.print_help()
        sys.exit(1)

    dispatch = {
        "health": cmd_health,
        "config": cmd_config,
        "scrape": cmd_scrape,
        "map": cmd_map,
        "crawl": cmd_crawl,
        "crawl-status": cmd_crawl_status,
        "crawl-cancel": cmd_crawl_cancel,
        "screenshot": cmd_screenshot,
        "pdf": cmd_pdf,
        "up": cmd_up,
        "down": cmd_down,
        "logs": cmd_logs,
    }

    fn = dispatch.get(args.command)
    if fn:
        fn(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
