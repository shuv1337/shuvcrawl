# Shuvcrawl MVP Implementation Summary

## Completed Tasks

### Phase 0 - Prerequisite Fix ✅
- Fixed browser session leak in `scraper.ts` by wrapping the browser-render block in try/finally

### Phase 1 - Core Pipeline Gaps ✅

#### 1.1 Real robots.txt parsing ✅
- Implemented full robots.txt parser with User-agent and Disallow/Allow directive support
- Added in-memory caching with 5-minute TTL
- Gracefully handles fetch errors (network failure = allowed)
- Added unit tests in `tests/unit/robots.test.ts`

#### 1.2 File-based response cache ✅
- Rewrote `src/storage/cache.ts` with full implementation:
  - SHA-256 hash-based filenames (16 hex chars)
  - Collision detection via stored key comparison
  - TTL-based expiration
  - `readCache()`, `writeCache()`, `listCache()`, `clearCache()` functions
- Integrated into `scraper.ts` with `noCache` option
- Added comprehensive unit tests in `tests/unit/cache.test.ts`

#### 1.3 Collision-safe output slugging ✅
- Updated `src/utils/url.ts` with `slugFromUrlWithHash()`:
  - Truncates to 192 chars + 7-char hash for long URLs
  - Deterministic hash generation
- Updated `src/storage/output.ts` with collision detection:
  - Numeric suffixes for slug collisions (-1, -2, etc.)
  - URL comparison to detect same vs different content
- Added unit tests in `tests/unit/url.test.ts`

#### 1.4 Per-domain rate limiter ✅
- Created `src/utils/rate-limit.ts` with `DomainRateLimiter` class:
  - Per-hostname request tracking
  - Configurable delay between requests
  - Non-blocking for first request to a domain
- Integrated into `Engine` for all operations (scrape, map, crawl, screenshot, pdf)
- Removed explicit delay from `crawl.ts` loop
- Added unit tests in `tests/unit/rate-limit.test.ts`

#### 1.5 Wait strategy support ✅
- Added to all pipeline functions:
  - `scraper.ts`: `load`, `networkidle`, `selector`, `sleep` strategies
  - `map.ts`: Same wait strategies
  - `capture.ts`: Applied to screenshot and PDF rendering
- Recorded in `metadata.waitStrategy`
- Added to API schemas (`ScrapeRequestSchema`, `MapRequestSchema`, etc.)
- Added CLI options: `--wait`, `--wait-for`, `--wait-timeout`, `--sleep`

#### 1.6 Scrape-specific CLI/API options ✅
- `--headers <json>` - Custom HTTP headers
- `--mobile` - Mobile viewport (390×844)
- `--raw-html` - Include raw HTML in output
- `--only-main-content` / `--no-only-main-content` - Control extraction scope
- `--no-cache` - Bypass cache for request

### Phase 2 - Crawl Completion ✅

#### 2.1 Crawl resume from disk state ✅
- Implemented `loadCrawlState()` in `src/storage/crawl-state.ts`
- Integrated into `crawlSite()` with `resume` option
- Validates seed URL on resume

#### 2.2 Sitemap discovery ✅
- Created `discoverSitemapUrls()` in `src/core/discovery.ts`:
  - Parses sitemap.xml
  - Handles sitemapindex (follows child sitemaps one level deep)
  - Returns `DiscoveredUrl[]` with `source: 'sitemap'`
- Integrated into `mapUrl()` and `crawlSite()` with `source` option

#### 2.3 Async crawl API + job registry ✅
- Created `JobRegistry` class in `src/core/job-registry.ts`:
  - In-memory job tracking
  - Fire-and-forget crawl execution
  - Cancellation via AbortSignal
- Added `crawlAsync()` method to `Engine`
- Updated API routes:
  - `POST /crawl` - Returns `{ jobId, status: 'running' }`
  - `GET /crawl/:jobId` - Get job status
  - `DELETE /crawl/:jobId` - Cancel job

#### 2.4 Crawl CLI progress output ✅
- Added progress callback to `crawlSite()`
- Progress line format: `[depth] status url +elapsed`
- Final summary line with visit counts

### Phase 3 - CLI/API Plumbing ✅

#### 3.1 `serve` command ✅
- Created `src/cli/commands/serve.ts`
- Supports `--port` and `--host` options
- Uses shared server start function

#### 3.2 `cache` subcommand ✅
- Created `src/cli/commands/cache.ts`:
  - `cache status` - Show cache stats
  - `cache list` - List cache entries
  - `cache clear` - Clear cache (with `--older-than` option)

#### 3.3 `update-bpc` subcommand ✅
- Created `src/cli/commands/update-bpc.ts`
- Reports BPC extension status
- Handles bundled/managed/custom modes

#### 3.4 Global CLI options ✅
- `--config <path>` - Config file override
- `--output <dir>` - Output directory override
- `--format <format>` - Output format override
- `--no-cache` - Disable cache
- `--no-robots` - Disable robots.txt checking
- `--proxy <url>` - Proxy configuration
- `--user-agent <ua>` - User agent override
- `--verbose` / `--quiet` - Log level control

### Phase 4 - Docker Deployment ✅
- Created `Dockerfile`:
  - Based on `oven/bun:1.2`
  - Installs Chromium dependencies
  - Installs Patchright Chromium
  - Includes BPC extension
- Created `docker-compose.yml`:
  - Port 3777 exposure
  - Volume mounts for output and data
  - Environment variable passthrough
  - Health check configuration
- Created `scripts/docker-smoke.sh` for smoke testing

### Phase 5 - Telemetry and Observability ✅

#### 5.1 OTLP HTTP export stub ✅
- Expanded `src/utils/telemetry.ts`:
  - In-memory span buffer
  - OTLP JSON format conversion
  - Background flush to HTTP endpoint
  - Process exit handling
- Added unit tests in `tests/unit/telemetry.test.ts`

#### 5.2 Console log artifact capture ✅
- Added console log collection to `BrowserSession`
- Implemented in `browser.ts` via page event handlers
- Writes to `console.json` artifact when enabled
- Applied to scraper, screenshot, and PDF functions

### Phase 6 - Test Coverage ✅
- 59 tests across 12 files
- All tests passing

## Validation

✅ `bun run typecheck` - passes
✅ `bun test` - 59 tests pass

## Usage Examples

```bash
# Scrape with wait strategy
bun run scrape https://example.com --wait networkidle

# Scrape with custom headers
bun run scrape https://example.com --headers '{"Authorization":"Bearer token"}'

# Mobile viewport
bun run scrape https://example.com --mobile

# Crawl with sitemap seeding
bun run crawl https://example.com --source sitemap --depth 2

# Resume crawl
bun run crawl https://example.com --resume

# Cache management
bun run cache status
bun run cache clear --older-than 86400

# Start API server
bun run serve --port 3777

# Docker
docker compose up
```

## Remaining Out of Scope (per spec)

- LLM extraction (V1.2)
- Browser pool concurrency / multi-page sessions (V2.0)
- Per-worker isolated profiles (V2.0)
- Proxy rotation (V2.0)
- Scheduled/recurring crawls (V2.0)
- Change detection / diffing (V2.0)
- MCP server interface (V2.0)
- Batch scrape POST /scrape/batch (deferred to V1.1)
- Webhook notifications (V1.2)
- --js-eval (post-MVP)
- --auth HTTP basic auth (post-MVP)
- --include-tags / --exclude-tags (post-MVP)
