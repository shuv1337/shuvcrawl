# HANDOFF — shuvcrawl MVP Complete

**Status:** MVP Complete + Post-MVP Hardening — 143 tests passing (126 unit + 17 integration), all core features operational  
**Version:** 0.1.0  
**Last Updated:** 2026-03-30

---

## Quick Summary

shuvcrawl is a self-hosted web scraping toolkit combining **Patchright** (undetected Playwright) with the **Bypass Paywalls Clean (BPC)** extension. It delivers clean markdown + structured JSON via CLI and REST API, packaged as a Docker Compose stack for homelab/VPS deployment.

**MVP Complete:** All Phase 0-6 features implemented per `IMPLEMENTATION_SUMMARY.md` — robots.txt parsing, file-based cache, collision-safe output, rate limiting, wait strategies, async crawl jobs, Docker deployment, and telemetry stubs.

---

## What Was Completed (Phase 0-6)

### Phase 0 — Prerequisite Fix ✅
- Fixed browser session leak in `scraper.ts` with try/finally wrapping

### Phase 1 — Core Pipeline Gaps ✅

| Feature | Implementation | Test Coverage |
|---------|---------------|---------------|
| **Real robots.txt parsing** | Full parser with User-agent, Disallow/Allow, 5-min TTL cache | `tests/unit/robots.test.ts` |
| **File-based response cache** | SHA-256 keyed, TTL expiration, collision detection | `tests/unit/cache.test.ts` |
| **Collision-safe output** | URL slug + 7-char hash, numeric suffixes for collisions | `tests/unit/url.test.ts` |
| **Per-domain rate limiting** | `DomainRateLimiter` with configurable delays | `tests/unit/rate-limit.test.ts` |
| **Wait strategies** | `load`, `networkidle`, `selector`, `sleep` for scrape/map/capture | All pipeline functions |
| **Scrape-specific options** | `--headers`, `--mobile`, `--raw-html`, `--only-main-content`, `--no-cache` | CLI + API schemas |

### Phase 2 — Crawl Completion ✅
- **Crawl resume:** `loadCrawlState()` with seed URL validation
- **Sitemap discovery:** `discoverSitemapUrls()` handles sitemap.xml + sitemapindex
- **Async crawl API:** `JobRegistry` with fire-and-forget execution, cancellation via AbortSignal
- **Crawl job endpoints:** `GET /crawl/:jobId`, `DELETE /crawl/:jobId`
- **CLI progress output:** `[depth] status url +elapsed` format with final summary

### Phase 3 — CLI/API Plumbing ✅
- **`serve` command:** `src/cli/commands/serve.ts` with `--port` and `--host`
- **`cache` subcommand:** `status`, `list`, `clear` with `--older-than` option
- **`update-bpc` subcommand:** Reports BPC extension status, handles bundled/managed/custom modes
- **Global CLI options:** `--config`, `--output`, `--format`, `--no-cache`, `--no-robots`, `--proxy`, `--user-agent`, `--verbose`/`--quiet`

### Phase 4 — Docker Deployment ✅
- **Dockerfile:** Bun 1.2 base, Chromium deps, Patchright install, BPC extension bundled
- **docker-compose.yml:** Port 3777, volume mounts for output/data, health checks, env passthrough
- **scripts/docker-smoke.sh:** Smoke testing for Docker deployment

### Phase 5 — Telemetry and Observability ✅
- **OTLP HTTP export stub:** In-memory span buffer, OTLP JSON conversion, background flush
- **Console log capture:** BrowserSession collects page console logs, writes to `console.json` artifact

### Phase 6 — Test Coverage ✅
- **66 tests** across **14 test files**
- All tests passing (`bun test`)
- Post-review fixes for race conditions, resource leaks, error handling gaps, type safety

---

## Architecture at a Glance

```
CLI (commander)          REST API (Hono)
    │                         │
    └──────────┬──────────────┘
               ▼
        ┌─────────────┐
        │    Engine   │ ──► BrowserPool, DomainRateLimiter, JobRegistry
        └──────┬──────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌─────────┐
│Scrape  │ │  Map   │ │ Capture │ ──► screenshots, PDF, console logs
│Pipeline│ │Crawl   │ │         │
└────────┘ └────────┘ └─────────┘
    │          │
    └──────────┴──────────► Storage (output/, cache/, crawl-state/)
```

---

## Working Commands

### CLI
```bash
# Core operations
bun run scrape -- https://example.com --json
bun run map -- https://example.com --json
bun run crawl -- https://example.com --depth 2 --limit 10 --json
bun run screenshot -- https://example.com --json
bun run pdf -- https://example.com --json

# Utility commands
bun run config -- --json
bun run version -- --json
bun run cache status
bun run cache clear --older-than 86400
bun run serve --port 3777

# With options
bun run scrape https://example.com --wait networkidle --mobile --json
bun run crawl https://example.com --source sitemap --depth 2 --resume
```

### API
```bash
# Health & config
GET  /health
GET  /config

# Core operations
POST /scrape    { url, options }
POST /map       { url, options }
POST /crawl     { url, options } → { jobId, status: 'running' }
GET  /crawl/:jobId
DELETE /crawl/:jobId

# Capture
POST /screenshot { url, options }
POST /pdf        { url, options }
```

### Docker
```bash
docker compose up
./scripts/docker-smoke.sh
```

---

## File Structure (Key Modules)

```
src/
├── api/                    # Hono REST API
│   ├── routes.ts          # All endpoints + job registry integration
│   ├── schemas.ts         # Zod request validation
│   ├── errors.ts          # Shared error mapping
│   └── middleware.ts      # Auth middleware
├── cli/                   # Commander CLI
│   ├── commands/          # scrape, map, crawl, screenshot, pdf, config, version, cache, serve
│   ├── error-handler.ts   # Structured error handling
│   └── output.ts          # Output formatting
├── core/                  # Engine + pipeline
│   ├── engine.ts          # Engine class (scrape, map, crawl, screenshot, pdf, crawlAsync)
│   ├── browser.ts         # BrowserPool with per-request profiles
│   ├── scraper.ts         # Fast-path + browser fallback pipeline
│   ├── map.ts             # URL discovery (links + sitemap)
│   ├── crawl.ts           # BFS crawl with resume support
│   ├── discovery.ts       # Link extraction + sitemap parsing
│   ├── job-registry.ts    # Async job tracking
│   ├── capture.ts         # Screenshots + PDF + console logs
│   ├── extractor.ts       # Readability-based content extraction
│   ├── converter.ts       # HTML → Markdown (Turndown)
│   ├── metadata.ts        # Request metadata generation
│   ├── bpc.ts             # BPC extension adapter
│   └── fast-path.ts       # Direct fetch without browser
├── storage/               # Persistence layer
│   ├── output.ts          # Collision-safe file writing
│   ├── cache.ts           # SHA-256 keyed file cache
│   ├── crawl-state.ts     # Crawl state save/load
│   └── artifacts.ts       # Artifact path management
├── utils/                 # Utilities
│   ├── telemetry.ts       # OTLP export stubs + context
│   ├── logger.ts          # Structured logging (stderr)
│   ├── rate-limit.ts      # DomainRateLimiter
│   ├── robots.ts          # Real robots.txt parser
│   └── url.ts             # URL normalization + slug generation
├── errors/                # Shared error classification
│   └── classify.ts        # Exit codes + error categories
├── config/                # Configuration
│   ├── schema.ts          # Zod config schema
│   ├── loader.ts          # Config file loading
│   ├── defaults.ts        # Default values
│   └── redact.ts          # Config redaction for logs
└── types/                 # Type definitions
```

---

## Known Issues & Limitations

| Issue | Severity | Notes |
|-------|----------|-------|
| **TLS/CA fast-path issue** | Medium | Local environment may lack proper CA certs; configurable `rejectUnauthorized` added as workaround. See `SHUVCRAWL_TLS_REJECT_UNAUTHORIZED`. |
| **OTLP not validated** | Low | Telemetry spans shaped correctly per unit tests, but no live Maple Ingest verification yet. |
| **No batch scrape** | Low | `/scrape/batch` deferred to V1.1 per spec. |
| **No webhooks** | Low | Async job completion webhooks deferred to V1.2. |
| **No README** | Low | **FIXED** — README.md added. |

---

## Recommended Next Steps

### High Priority — Stabilization
1. **Push commits** — 6 unpushed commits need to go to remote
2. **Validate OTLP against Maple Ingest** — Test telemetry end-to-end
3. **Docker smoke test** — Run `scripts/docker-smoke.sh` in clean environment
4. **End-to-end crawl resume** — Test `--resume` flag manually

### Completed Since Last Update
- ✅ **Persistent job queue** — SQLite backing implemented
- ✅ **Integration tests** — 17 tests with real browser launch
- ✅ **Production telemetry** — Parent-child spans, proper trace/span IDs
- ✅ **TLS handling** — Configurable `rejectUnauthorized` and CA bundle path
- ✅ **README** — Comprehensive documentation added

### Medium Priority
- Batch scrape endpoint (`/scrape/batch`)
- Webhook notifications for job completion
- Browser pool concurrency (V2.0)
- Proxy rotation
- Per-worker isolated profiles

---

## Validation Commands

```bash
# Type checking (clean)
bun run typecheck

# Unit tests only (126 tests, <1s)
bun test

# Integration tests only (17 tests, requires Chromium, ~20s)
bun run test:integration

# All tests (143 total)
bun run test:all

# CLI smoke tests
bun run scrape -- https://example.com --json
bun run map -- https://example.com --json
bun run crawl -- https://example.com --depth 0 --limit 1 --json

# API smoke test (with server running)
curl -s http://localhost:3777/health

# Docker smoke test
./scripts/docker-smoke.sh
```

---

## Output Locations

```
output/
├── {domain}/
│   ├── {slug}.md              # Extracted content
│   ├── {slug}.json            # Structured data
│   ├── _meta.jsonl            # Metadata log
│   └── _crawl-state.json      # Crawl resume state
└── _artifacts/
    └── {requestId}/
        ├── page.png           # Screenshot
        ├── page.pdf           # PDF render
        └── console.json       # Browser console logs
```

---

## Git Status

**6 unpushed commits** ahead of origin/master with post-MVP hardening:
- `792142b` — Integration tests with real browser launch (17 tests)
- `f918804` — Production OTLP telemetry with parent-child spans
- `5394054` — TLS schema fix after SQLite branch merge
- `183d741` — End-to-end crawl resume tests (920 lines)
- `29705e7` — SQLite-backed persistent job queue
- `ac057c3` — TLS/CA handling for fast-path fetch

Plus uncommitted changes:
- `bunfig.toml` — Exclude integration tests from default `bun test` (prevents mock.module leakage)
- `README.md` — New comprehensive project documentation
- `package.json` — New test scripts (test:integration, test:all)
- `tests/` — Type fixes and helper refactors for clean typecheck
- `b689d81` — Scraping engine core
- `fc789cb` — Types, config, utilities, storage
- `6c4d018` — Initial project setup

---

## Resources

- **Spec:** `shuvcrawl-spec.md`
- **MVP Implementation Summary:** `IMPLEMENTATION_SUMMARY.md`
- **Visual Project Recap:** https://files.shuv.me/shuvcrawl-project-recap.html
- **Spike Reports:** `spikes/patchright-bpc/output/reports/`
