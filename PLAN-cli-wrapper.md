# shuvcrawl CLI Wrapper — Plan

## Goal

A thin Python CLI (`sc`) that wraps the shuvcrawl REST API so the agent (and user) can issue one-line commands instead of multi-line curl+JSON. Reads `SHUVCRAWL_API_TOKEN` and `SHUVCRAWL_API_URL` from env. Zero external dependencies beyond Python stdlib.

---

## Command Tree

```
sc — shuvcrawl CLI wrapper

USAGE:
  sc <command> [options]

GLOBAL OPTIONS:
  --api-url URL        API base URL (default: $SHUVCRAWL_API_URL or http://localhost:3777)
  --token TOKEN        API bearer token (default: $SHUVCRAWL_API_TOKEN)
  --json               Output raw JSON response instead of formatted text
  --no-color           Disable colored output
  -h, --help           Show help

COMMANDS:

  sc health
    Check service health.
    Example: sc health

  sc config
    Show running server config (redacted).
    Example: sc config

  sc scrape <url> [options]
    Scrape a single page and extract content as markdown.
    Options:
      --wait STRATEGY        Wait strategy: load | networkidle | selector | sleep (default: load)
      --wait-for SELECTOR    CSS selector to wait for (with --wait selector)
      --wait-timeout MS      Timeout for wait-for in ms (default: 30000)
      --sleep MS             Sleep ms after page load
      --selector CSS         CSS selector to scope extraction
      --raw-html             Include raw HTML in output
      --main-content         Extract only main content (default: true)
      --no-main-content      Extract full page
      --no-fast-path         Force browser rendering (skip fast path)
      --no-bpc               Disable Bypass Paywalls Clean
      --no-cache             Bypass cache
      --mobile               Emulate mobile viewport
      --debug-artifacts      Save debug artifacts
      --header KEY=VALUE     Custom header (repeatable)
      -o, --output FILE      Write markdown content to file
    Example:
      sc scrape https://example.com/article
      sc scrape https://wsj.com/article --wait networkidle --no-cache --sleep 5000
      sc scrape https://example.com --selector "article.main" -o article.md

  sc map <url> [options]
    Discover URLs from a page or sitemap.
    Options:
      --source SOURCE        URL source: links | sitemap | both (default: both)
      --include PATTERN      Include URL glob pattern (repeatable)
      --exclude PATTERN      Exclude URL glob pattern (repeatable)
      --same-origin          Only same-origin URLs (default: true)
      --no-same-origin       Allow cross-origin URLs
      --no-fast-path         Force browser rendering
      --no-bpc               Disable BPC
      --wait STRATEGY        Wait strategy (default: load)
    Example:
      sc map https://example.com
      sc map https://example.com --source sitemap --include "https://example.com/blog/**"

  sc crawl <url> [options]
    Start an async multi-page crawl job.
    Options:
      --depth N              Max crawl depth (default: 3)
      --limit N              Max pages to crawl (default: 50)
      --delay MS             Per-domain delay in ms (default: 1000)
      --source SOURCE        URL source: links | sitemap | both (default: links)
      --include PATTERN      Include URL glob pattern (repeatable)
      --exclude PATTERN      Exclude URL glob pattern (repeatable)
      --resume               Resume a previous crawl
      --no-fast-path         Force browser rendering
      --no-bpc               Disable BPC
      --no-cache             Bypass cache
      --debug-artifacts      Save debug artifacts
      --wait STRATEGY        Wait strategy (default: load)
      --poll                 Poll until job completes (default: return jobId immediately)
      --poll-interval SEC    Seconds between poll checks (default: 5)
    Example:
      sc crawl https://example.com --depth 2 --limit 10 --poll
      sc crawl https://example.com --include "https://example.com/docs/**" --limit 20

  sc crawl-status <jobId>
    Check status of a crawl job.
    Example: sc crawl-status job_abc123

  sc crawl-cancel <jobId>
    Cancel a running crawl job.
    Example: sc crawl-cancel job_abc123

  sc screenshot <url> [options]
    Capture a screenshot of a page.
    Options:
      --full-page            Capture full page (default: viewport only)
      --wait STRATEGY        Wait strategy (default: load)
      --wait-for SELECTOR    CSS selector to wait for
      --wait-timeout MS      Timeout in ms (default: 30000)
      --sleep MS             Sleep ms after page load
      -o, --output FILE      Save screenshot to file path
    Example:
      sc screenshot https://example.com --full-page -o page.png

  sc pdf <url> [options]
    Render a page as PDF.
    Options:
      --format FORMAT        Page format: A4 | Letter | Legal | Tabloid (default: A4)
      --landscape            Landscape orientation
      --wait STRATEGY        Wait strategy (default: networkidle)
      -o, --output FILE      Save PDF to file path
    Example:
      sc pdf https://example.com --format Letter -o page.pdf

  sc up
    Start shuvcrawl in Docker (docker compose up -d).
    Example: sc up

  sc down
    Stop shuvcrawl Docker container.
    Example: sc down

  sc logs
    Tail shuvcrawl Docker container logs.
    Example: sc logs
```

---

## Architecture

```
sc (Python script, ~400 lines)
├── Single file: ~/repos/shuvcrawl/sc
├── Shebang: #!/usr/bin/env python3
├── Zero dependencies (stdlib only: argparse, json, urllib.request, os, sys, subprocess, time)
├── Symlink to ~/.local/bin/sc for PATH access
└── Reads SHUVCRAWL_API_TOKEN + SHUVCRAWL_API_URL from env or .env file in repo
```

### Key Design Decisions

1. **Single file, zero deps** — just Python stdlib. No pip install, no venv. Works anywhere Python 3.8+ exists.

2. **Smart defaults** — `--main-content` is on by default (most common use case). `--wait load` is default. Token auto-reads from env or `~/repos/shuvcrawl/.env`.

3. **Formatted output by default** — scrape prints markdown content directly to stdout (pipe-friendly). `--json` flag for raw API response when needed.

4. **Scrape output format** (default, no --json):
   ```
   # Title of Article
   
   > Author | Published: 2024-01-15 | 1,234 words | method: readability
   
   [markdown content here...]
   ```

5. **Map output format** (default, no --json):
   ```
   Found 42 URLs:
   https://example.com/page-1
   https://example.com/page-2
   ...
   ```

6. **Crawl output format** (default, no --json):
   ```
   Crawl started: job_abc123
   Polling... [3/10 pages] ██████░░░░ 30%
   Done: 10 pages crawled in 45s
   ```

7. **Screenshot/PDF output**: prints artifact path, or saves to `-o` path.

8. **Error output**: clean single-line errors to stderr.
   ```
   Error [UNAUTHORIZED]: Missing or wrong bearer token
   ```

9. **Token resolution order**: `--token` flag > `$SHUVCRAWL_API_TOKEN` env > `.env` file in repo dir > `.env` in cwd.

10. **Docker helpers** (`sc up/down/logs`): thin wrappers around `docker compose` in the repo dir.

---

## Implementation Order

1. Scaffold: argparse with subcommands, global options, API client helper
2. `health` + `config` (simplest — validate plumbing)
3. `scrape` with all options + formatted output
4. `map` with formatted URL list output
5. `screenshot` + `pdf` with artifact download
6. `crawl` + `crawl-status` + `crawl-cancel` with poll loop
7. `up` / `down` / `logs` docker helpers
8. Symlink to PATH, update skill references

---

## Open Questions

- Should `sc scrape` auto-detect paywalled sites and suggest `--no-fast-path --sleep 5000`?
- Should there be a `sc batch` command for scraping a list of URLs from a file?
- Should crawl poll output show per-page results as they come in?
