# shuvcrawl

Self-hosted web scraping toolkit combining [Patchright](https://github.com/nicehash/patchright) (undetected Playwright) with the [Bypass Paywalls Clean](https://github.com/nicehash/bypass-paywalls-chrome-clean) (BPC) extension. Extracts article content as clean markdown + structured JSON. CLI, REST API, and Docker deployment.

## Quick Start

### Local

```bash
# Install dependencies
bun install

# Install Patchright Chromium
bunx patchright install chromium

# Scrape a page
bun run scrape -- https://example.com --json

# Map links on a page
bun run map -- https://example.com --json

# Crawl a site
bun run crawl -- https://example.com --depth 2 --limit 10 --json

# Take a screenshot
bun run screenshot -- https://example.com --json

# Render a PDF
bun run pdf -- https://example.com --json
```

### Docker

```bash
docker compose up -d
curl http://localhost:3777/health
```

## CLI Reference

```
shuvcrawl <command> [options]

Commands:
  scrape <url>       Scrape a URL and extract content
  map <url>          Discover URLs on a page (links + sitemap)
  crawl <url>        Crawl a site starting from URL
  screenshot <url>   Capture a screenshot
  pdf <url>          Render a page as PDF
  config             Show current configuration
  version            Show version info
  cache <sub>        Cache management (status, list, clear)
  serve              Start the REST API server
  update-bpc         Inspect BPC extension status
```

### Global Options

| Option | Description |
|--------|-------------|
| `--config <path>` | Config file override |
| `--output <dir>` | Output directory |
| `--format <fmt>` | Output format (`markdown` or `json`) |
| `--json` | Output as JSON |
| `--no-cache` | Bypass response cache |
| `--no-robots` | Skip robots.txt checking |
| `--proxy <url>` | Proxy URL (HTTP or SOCKS5) |
| `--user-agent <ua>` | Custom user agent |
| `--verbose` | Debug-level logging |
| `--quiet` | Error-only logging |

### Scrape Options

| Option | Description |
|--------|-------------|
| `--wait <strategy>` | Wait strategy: `load`, `networkidle`, `selector`, `sleep` |
| `--wait-for <sel>` | CSS selector to wait for |
| `--wait-timeout <ms>` | Wait timeout in ms (default: 30000) |
| `--sleep <ms>` | Fixed delay after load |
| `--headers <json>` | Custom HTTP headers as JSON |
| `--mobile` | Mobile viewport (390×844) |
| `--raw-html` | Include raw HTML in output |
| `--only-main-content` | Extract main content only (default) |
| `--no-only-main-content` | Extract full body |

### Crawl Options

| Option | Description |
|--------|-------------|
| `--depth <n>` | Maximum link depth (default: 3) |
| `--limit <n>` | Maximum pages (default: 50) |
| `--include <glob>` | Allowed URL patterns |
| `--exclude <glob>` | Denied URL patterns |
| `--delay <ms>` | Per-domain delay (default: 1000ms) |
| `--source <type>` | Discovery source: `links`, `sitemap`, or `both` |
| `--resume` | Resume from saved crawl state |

### Cache Commands

```bash
bun run cache status            # Show cache stats
bun run cache list              # List cache entries
bun run cache clear             # Clear all
bun run cache clear --older-than 86400  # Clear entries older than 24h
```

## REST API

Start the server:

```bash
bun run serve -- --port 3777
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health + config summary |
| `GET` | `/config` | Current configuration (redacted) |
| `POST` | `/scrape` | Scrape a URL |
| `POST` | `/map` | Discover URLs |
| `POST` | `/crawl` | Start async crawl (returns `jobId`) |
| `GET` | `/crawl/:jobId` | Get crawl job status |
| `DELETE` | `/crawl/:jobId` | Cancel a crawl job |
| `POST` | `/screenshot` | Capture a screenshot |
| `POST` | `/pdf` | Render a PDF |

### Authentication

Set `SHUVCRAWL_API_TOKEN` to require bearer token auth:

```bash
SHUVCRAWL_API_TOKEN=secret123 bun run serve
curl -H "Authorization: Bearer secret123" http://localhost:3777/health
```

### Request Example

```bash
curl -X POST http://localhost:3777/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article", "options": {"waitStrategy": "networkidle"}}'
```

### Response Format

```json
{
  "success": true,
  "data": {
    "url": "https://example.com/article",
    "content": "# Article Title\n\nArticle body...",
    "html": "<article>...</article>",
    "metadata": {
      "requestId": "req_abc123",
      "title": "Article Title",
      "bypassMethod": "bpc-extension",
      "status": "success",
      "elapsed": 2341
    }
  }
}
```

## Configuration

Config file: `~/.shuvcrawl/config.json` (or `$SHUVCRAWL_CONFIG`, or `--config <path>`)

All values can be overridden via environment variables: `SHUVCRAWL_{SECTION}_{KEY}`.

| Variable | Description | Default |
|----------|-------------|---------|
| `SHUVCRAWL_API_PORT` | API server port | `3777` |
| `SHUVCRAWL_API_TOKEN` | Bearer auth token | none |
| `SHUVCRAWL_CACHE_TTL` | Cache TTL in seconds | `3600` |
| `SHUVCRAWL_CRAWL_DELAY` | Per-domain delay in ms | `1000` |
| `SHUVCRAWL_BPC_ENABLED` | Enable BPC extension | `true` |
| `SHUVCRAWL_BROWSER_HEADLESS` | Headless mode | `true` |
| `SHUVCRAWL_TLS_REJECT_UNAUTHORIZED` | TLS certificate validation | `true` |
| `SHUVCRAWL_TELEMETRY_OTLPHTTPENDPOINT` | OTLP collector URL | none |

## Output Structure

```
output/
├── {domain}/
│   ├── {slug}.md              # Extracted markdown
│   ├── {slug}.json            # Structured data
│   ├── _meta.jsonl            # Metadata log (append-only)
│   └── _crawl-state.json     # Crawl resume state
└── _artifacts/
    └── {requestId}/
        ├── page.png           # Screenshot
        ├── page.pdf           # PDF render
        ├── raw.html           # Raw page HTML
        ├── clean.html         # Cleaned HTML
        └── console.json       # Browser console logs
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration or auth error |
| 3 | Network error |
| 4 | Validation error |
| 5 | Extraction failed |
| 6 | Robots denied |
| 7 | Rate limited |
| 8 | Browser/extension init failed |

## Development

```bash
# Type checking
bun run typecheck

# Unit tests (126 tests)
bun test

# Integration tests (requires Chromium — 17 tests)
bun run test:integration

# All tests
bun run test:all

# Start dev server
bun run serve
```

## Architecture

```
CLI (commander)          REST API (Hono)
    │                         │
    └──────────┬──────────────┘
               ▼
           Engine ──► BrowserPool, DomainRateLimiter, JobRegistry (SQLite)
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
 Scrape     Map/Crawl   Capture
 Pipeline   (BFS+       (screenshot,
 (fast-path  sitemap)    PDF, console)
  → browser
  → extract
  → convert)
    │          │          │
    └──────────┴──────────┘
               ▼
         Storage Layer
    (output/, cache/, artifacts/, SQLite job store)
```

## License

Private — not yet published.
