# shuvcrawl - Technical Specification

**Version:** 0.1.1-draft
**Date:** 2026-03-27
**Author:** Kyle (Latitudes MSP)
**Status:** Spec (pre-PRD, revised)

---

## 1. Project Summary

shuvcrawl is a self-hosted, open-source web scraping and crawling toolkit optimized for extracting article-style content from public websites, news sites, blogs, and documentation properties. It combines Patchright (an undetected Playwright-compatible Chromium driver) with the Bypass Paywalls Clean (BPC) Chromium extension to improve access on sites that use soft paywalls, metering, anti-bot gating, or heavy client-side rendering.

The system outputs clean markdown and structured JSON to disk, exposes both a CLI and REST API, and is designed to run as a single Docker Compose stack on a homelab or VPS.

### 1.1 What This Is

A focused scraping tool for:

- article extraction from public websites
- bypass-aware rendering for soft paywalls and metered access
- sitemap/link discovery and small-to-medium crawls
- reliable archival output to markdown + JSON
- structured downstream processing via optional LLM extraction

### 1.2 What This Is Not

This is not:

- a distributed crawler or search engine
- a SaaS platform
- a browser automation framework for arbitrary web apps
- a full replacement for Firecrawl, Crawl4AI, or Browser Rendering APIs
- a credential manager or account-login automation system

shuvcrawl prioritizes **content access and clean extraction** over breadth, scale, or general-purpose automation.

---

## 2. Architecture Overview

### 2.1 Component Stack

```text
┌──────────────────────────────────────────────────────────────┐
│                          shuvcrawl                           │
│                                                              │
│  ┌─────────────┐                    ┌──────────────────────┐  │
│  │     CLI     │                    │       REST API       │  │
│  │ commander   │                    │        Hono          │  │
│  └──────┬──────┘                    └──────────┬───────────┘  │
│         │                                      │              │
│         └──────────────────┬───────────────────┘              │
│                            ▼                                  │
│                ┌───────────────────────────┐                  │
│                │        Core Engine        │                  │
│                │ ┌───────────────────────┐ │                  │
│                │ │ Job / Request Orchestr│ │                  │
│                │ └───────────┬───────────┘ │                  │
│                │             ▼             │                  │
│                │ ┌───────────────────────┐ │                  │
│                │ │ Browser Manager /     │ │                  │
│                │ │ BrowserPool (V1=1)    │ │                  │
│                │ │ + profile strategy    │ │                  │
│                │ │ + BPC adapter         │ │                  │
│                │ └───────────┬───────────┘ │                  │
│                │             ▼             │                  │
│                │ ┌───────────────────────┐ │                  │
│                │ │ Scrape Pipeline       │ │                  │
│                │ │ Fetch → Render →      │ │                  │
│                │ │ Extract → Convert →   │ │                  │
│                │ │ Store → Emit telemetry│ │                  │
│                │ └───────────────────────┘ │                  │
│                └───────────────────────────┘                  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Output / State / Cache                                │   │
│  │ ./output/{domain}/                                    │   │
│  │   ├── {slug}.md                                       │   │
│  │   ├── {slug}.json                                     │   │
│  │   ├── _meta.jsonl                                     │   │
│  │   ├── _crawl-state.json                               │   │
│  │   └── artifacts/{requestId}/...                       │   │
│  └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Fast startup, native TypeScript, built-in test runner |
| Browser automation | patchright | Playwright-compatible API with stealth behavior |
| Paywall bypass | BPC Chromium extension | Large maintained per-site ruleset; cookie/header/script manipulation |
| CLI | commander or yargs | Conventional, simple subcommand UX |
| REST API | Hono | Lightweight and Bun-friendly |
| HTML → Markdown | Turndown + GFM plugin | Mature and customizable |
| Primary extraction | @mozilla/readability | Standard article extraction baseline |
| Optional LLM extraction | OpenAI-compatible client | Provider-agnostic; self-hosted or hosted |
| Validation | zod | Typed request/config schemas |
| Containerization | Docker Compose | Homelab/VPS deployment target |
| Logging / telemetry | structured JSON logs + OTLP instrumentation | Day-zero observability |

### 2.3 Concurrency Model (Planned, Not V1)

V1 is single-browser, sequential page processing. The codebase must still preserve a future path to:

- a `BrowserPool` with configurable warm contexts
- per-context BPC extension instances / isolated profiles
- an in-process queue replaceable later with Redis or similar
- configurable backpressure and request timeouts
- context recycling after N pages to reduce memory and fingerprint accumulation

V1 callers should depend on abstractions like `BrowserPool.acquire()` / `release()` even if only one context exists initially.

---

## 3. BPC Extension Integration

### 3.1 Approach

shuvcrawl loads a Chromium unpacked extension into a persistent Chromium context managed by Patchright. BPC is treated as an embedded rules engine with:

- background service worker logic
- content scripts
- declarative/request-time blocking rules
- storage-backed per-site configuration

The implementation must not treat BPC as a black box. shuvcrawl needs an explicit adapter for bootstrapping, configuring, and verifying the extension at runtime.

### 3.2 Runtime Source Strategy

The BPC source must be configurable because there are multiple viable operating modes:

1. **Bundled fork path** — use a local unpacked extension directory already present on disk (for example a pinned `./bcp-clean/` checkout in the repo)
2. **Managed local install** — fetch/update into `~/.shuvcrawl/extensions/bpc/`
3. **Explicit custom path** — user points at an unpacked fork/mirror

The spec does **not** assume one permanent source strategy yet. The runtime source is selected by config.

### 3.3 Extension Loading and Readiness

Patchright/Chromium extension loading requires a persistent context and startup flags:

- `--disable-extensions-except={bpcPath}`
- `--load-extension={bpcPath}`

The V1 startup sequence must be:

1. resolve BPC source path
2. launch persistent Chromium context with extension flags
3. wait for the MV3 extension service worker to appear
4. seed or reconcile BPC storage keys as needed
5. verify BPC readiness using a health check step
6. only then navigate to the target URL

This readiness phase is mandatory. The first navigation in a fresh profile must not race ahead of extension initialization.

### 3.4 Browser Profile Strategy

BPC relies on `chrome.storage.local` and optional host permissions, so browser profile handling is critical.

V1 must define a browser profile model explicitly:

- `userDataDir` is persistent and configurable
- shuvcrawl owns a profile root under `~/.shuvcrawl/browser/`
- the active runtime profile is derived from a managed template or base profile
- shuvcrawl can reset runtime state without deleting the extension source
- cookie/session bleed between unrelated jobs is minimized

Recommended V1 model:

- maintain a **template profile** containing only extension installation + approved baseline settings
- create a **runtime profile** from that template for normal operation
- allow a `--profile-reset` / admin reset workflow to rebuild from template
- document that future multi-worker support will require one runtime profile per worker/context

### 3.5 BPC Adapter Layer

shuvcrawl needs a dedicated adapter that translates its config into the storage model used by this BPC fork.

Relevant storage concepts in the current fork include:

- `sites`
- `sites_excluded`
- `sites_custom`
- `sites_updated`
- `optIn`
- `customOptIn`
- `optInUpdate`

The shuvcrawl-facing config must be friendlier than raw extension storage, but the adapter must map deterministically into extension storage.

### 3.6 BPC Configuration Model

shuvcrawl must expose BPC behavior via its own config, not by asking users to manipulate extension UI state manually.

Goals:

- configure enabled/disabled extension behavior without opening the options page
- manage excluded domains for legitimate subscriptions
- optionally seed custom/updated site entries
- support conservative vs aggressive modes
- detect and surface permission gaps for domains requiring optional host access

Example conceptual mapping:

```jsonc
{
  "bpc": {
    "enabled": true,
    "sourceMode": "bundled",           // bundled | managed | custom
    "path": "./bcp-clean",
    "source": null,
    "mode": "conservative",            // conservative | aggressive
    "excludeDomains": ["wsj.com"],
    "enableUpdatedSites": true,
    "enableCustomSites": false,
    "storageOverrides": {
      "sites_custom": {},
      "sites_updated": {}
    }
  }
}
```

Notes:

- **conservative** mode should align more closely with the fork’s shipped defaults
- **aggressive** mode may opt into broader behavior, but only when technically safe and clearly documented
- excluded domains must map to extension storage in a way that allows real subscriber sessions to work

### 3.7 Extension Compatibility Considerations

The inspected fork currently has the following relevant traits:

- Manifest V3 service worker background script
- heavy use of `chrome.storage.local`
- request header mutation (including referer, user-agent, `X-Forwarded-For`)
- cookie clearing/selective cookie retention
- content-script DOM mutation and JSON extraction fallbacks
- optional host permission behavior for some custom/updated sites
- remote auto-update logic intentionally disabled in the fork

These behaviors affect shuvcrawl design directly. In particular:

- extension storage state must be deterministic
- optional host permissions may affect coverage for non-default domains
- future worker concurrency cannot safely share one mutable runtime profile

### 3.8 Update Lifecycle

`shuvcrawl update-bpc` must support the configured source mode.

Expected behavior:

- **bundled mode**: inspect/report version and optionally warn that updates are repo-managed rather than auto-fetched
- **managed mode**: fetch/pull unpacked extension source into `~/.shuvcrawl/extensions/bpc/`
- **custom mode**: validate path and report current version, but do not mutate unless explicitly allowed

The implementation must acknowledge BPC source instability and takedown risk. Source URLs should be configurable rather than hardcoded.

---

## 4. Core Engine

### 4.1 Scrape Pipeline (Single URL)

Every other feature composes on top of the single-URL scrape pipeline.

```text
Input: URL + options
  │
  ▼
┌────────────────────────────┐
│ 1. Pre-flight              │
│    - assign requestId      │
│    - normalize URL         │
│    - robots policy check   │
│    - per-domain delay      │
│    - cache lookup          │
└────────────┬───────────────┘
             ▼
┌────────────────────────────┐
│ 2. Fast-path fetch         │
│    - bypass headers        │
│    - lightweight extract   │
│    - accept/reject         │
└────────────┬───────────────┘
             ▼ (if needed)
┌────────────────────────────┐
│ 3. Browser render          │
│    - acquire browser       │
│    - ensure BPC ready      │
│    - navigate              │
│    - wait strategy         │
│    - collect DOM/HTML      │
└────────────┬───────────────┘
             ▼
┌────────────────────────────┐
│ 4. Content extraction      │
│    - Readability           │
│    - selector fallback     │
│    - full-body fallback    │
│    - metadata extraction   │
└────────────┬───────────────┘
             ▼
┌────────────────────────────┐
│ 5. Conversion              │
│    - clean HTML            │
│    - markdown             │
│    - optional LLM extract  │
└────────────┬───────────────┘
             ▼
┌────────────────────────────┐
│ 6. Finalization            │
│    - write outputs         │
│    - append meta log       │
│    - write artifacts       │
│    - emit telemetry        │
└────────────────────────────┘
```

### 4.2 Pre-flight Rules

Pre-flight is responsible for the guardrails that make output repeatable and polite:

- URL normalization
- canonical same-document fragment stripping
- robots.txt policy check (configurable, default respect)
- per-domain delay / rate limiting
- cache lookup
- request ID / correlation ID assignment
- timeout budget initialization

If robots are respected and the URL is disallowed, the scrape should fail fast with a distinct result code.

### 4.3 Fast-Path Fetch

Many sites will serve usable content without a browser when requested with search-engine-style headers. shuvcrawl should attempt a lightweight fetch before browser render unless disabled.

Default behavior:

- `User-Agent: Googlebot/2.1 (+http://www.google.com/bot.html)` or equivalent configured value
- `Referer: https://www.google.com/`
- clean cookie jar for the request
- follow redirects
- run a low-cost extraction confidence test

The fast-path should be accepted only if:

- extracted content length exceeds the configured threshold
- title/content confidence passes a heuristic score
- the page is not obviously blocked, truncated, or teaser-only

The fast-path should record why it was accepted or rejected for telemetry/debugging.

### 4.4 Browser Render

If fast-path is skipped or rejected, shuvcrawl renders the page in Chromium.

V1 browser rendering requirements:

- use Patchright persistent context
- load BPC and verify readiness before navigation
- apply wait strategy and hard timeout
- support custom headers, proxy, and viewport/mobile emulation
- capture redirect chain, final URL, and selected browser signals for diagnostics

### 4.5 Wait Strategies

Different sites require different waiting models.

| Strategy | Flag | Behavior |
|----------|------|----------|
| `load` | `--wait load` | Wait for page `load` event |
| `networkidle` | `--wait networkidle` | Wait for network idle heuristic |
| `selector` | `--wait-for "article.content"` | Wait for a CSS selector |
| `sleep` | `--sleep 2000` | Fixed delay after load |
| `timeout` | `--wait-timeout 30000` | Hard timeout budget |

Wait strategy decisions should be captured in logs and optionally in artifacts/debug metadata.

### 4.6 Content Extraction Strategy

Extraction is layered with fallbacks:

1. **Readability** — primary article extraction
2. **Selector override** — user/domain override when Readability fails or underperforms
3. **Full-body fallback** — strip obvious junk and convert remaining body

Selector overrides should support:

- config file defaults
- CLI/API per-request override
- domain-scoped persistent overrides

### 4.7 Metadata Extraction

Every scrape should capture structured metadata alongside content.

```typescript
interface ScrapeMetadata {
  requestId: string;
  url: string;
  originalUrl: string;
  finalUrl: string;
  canonicalUrl: string | null;
  title: string;
  author: string | null;
  publishedAt: string | null;
  modifiedAt: string | null;
  description: string | null;
  siteName: string | null;
  language: string | null;
  wordCount: number;
  extractionMethod: "readability" | "selector" | "fullbody";
  extractionConfidence: number | null;
  bypassMethod: "fast-path" | "bpc-extension" | "direct";
  waitStrategy: "load" | "networkidle" | "selector" | "sleep";
  browserUsed: boolean;
  scrapedAt: string;
  elapsed: number;
  status: "success" | "partial" | "failed" | "blocked" | "robots-denied";
  openGraph: Record<string, string> | null;
  twitterCards: Record<string, string> | null;
  ldJson: object[] | null;
  responseHeaders?: Record<string, string> | null;
}
```

Notes:

- `canonicalUrl` is for metadata and dedupe reporting, not an automatic replacement for the requested URL in all cases
- `status` must distinguish total failure from partial extraction
- `browserUsed` is useful for cost/performance analysis

### 4.8 Debug Artifacts

V1 should support an explicit debug/artifact mode because paywall and anti-bot behavior changes frequently.

Artifact capture options:

- raw HTML
- cleaned HTML
- screenshot
- PDF (when requested)
- console logs
- selected network metadata / redirect chain
- extraction trace (which fallback path won)
- browser timing summary

Artifacts should be writable:

- always on failure, if configured
- always for specific commands like `screenshot` / `pdf`
- optionally for every request when `--debug-artifacts` is enabled

### 4.9 Structured Logging and Telemetry

Telemetry is a V1 requirement, not a future enhancement.

Minimum V1 contract:

- structured JSON logs for request/job lifecycle events
- stable IDs for request, crawl job, and page result correlation
- per-stage timings (pre-flight, fast-path, browser, extraction, conversion, write)
- explicit failure telemetry with error class/cause
- spans/traces for multi-step flows when OTLP export is enabled

Telemetry outputs:

- stdout/stderr JSON logs by default
- optional OTLP HTTP export
- when OTLP export is enabled, Maple Ingest is the intended first hop

---

## 5. LLM Structured Extraction

### 5.1 Overview

Optional feature. After content extraction, the resulting markdown can be sent to an OpenAI-compatible endpoint for structured extraction.

### 5.2 Configuration

```jsonc
{
  "llm": {
    "endpoint": "http://localhost:11434/v1",
    "model": "llama3.2",
    "apiKey": null,
    "maxTokens": 4096,
    "temperature": 0
  }
}
```

Environment variable overrides:

- `SHUVCRAWL_LLM_ENDPOINT`
- `SHUVCRAWL_LLM_MODEL`
- `SHUVCRAWL_LLM_API_KEY`

### 5.3 Extraction Interface

```bash
shuvcrawl extract "Get the headline, author, date, and a 2-sentence summary" \
  --url https://example.com/article \
  --format json

shuvcrawl extract --url https://example.com/article \
  --schema '{"title":"string","author":"string","publishedDate":"string","summary":"string"}'

shuvcrawl extract --from ./output/example.com/some-article.md \
  --schema-file ./schemas/article.json
```

### 5.4 Implementation Notes

- send extracted markdown, not raw full HTML, by default
- support schema-guided extraction and validation
- retry once on invalid JSON output
- record prompt/model/elapsed in telemetry
- support `--from` to avoid refetching already-scraped content

---

## 6. Crawl Orchestration

### 6.1 Crawl Model

A crawl is a breadth-first traversal over URLs derived from a seed URL. It reuses the scrape pipeline for each page, subject to crawl policy.

```bash
shuvcrawl crawl https://docs.example.com \
  --depth 3 \
  --limit 100 \
  --include "https://docs.example.com/**" \
  --exclude "**/changelog/**" \
  --format markdown
```

### 6.2 Crawl Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--depth` | 3 | Maximum link depth |
| `--limit` | 50 | Maximum pages |
| `--include` | same-origin | Allowed URL globs |
| `--exclude` | none | Denied URL globs |
| `--format` | markdown | Output format(s) |
| `--delay` | 1000 | Per-domain delay in ms |
| `--respect-robots` | true | Honor robots.txt |
| `--source` | links | `links`, `sitemap`, or `both` |
| `--resume` | false | Resume from crawl state |
| `--output` | `./output/{domain}/` | Output directory |

### 6.3 URL Discovery

1. **Sitemap** — parse `sitemap.xml` and sitemap indexes when enabled
2. **Page links** — extract anchor URLs from scraped pages
3. **Normalization** — strip fragments, sort query params where appropriate, lowercase host
4. **Filtering** — include/exclude patterns, robots policy, and same-origin policy as configured
5. **Deduplication** — maintain visited and enqueued sets using normalized URL identity

### 6.4 Crawl State and Persistence

Crawl state is written to `./output/{domain}/_crawl-state.json`.

State must include:

- crawl job ID
- seed URL
- normalized crawl options
- pending queue
- visited set
- per-URL depth
- per-URL status/result summary
- started/updated timestamps
- cancellation/completion markers

This enables:

- `shuvcrawl crawl --resume`
- API status reconstruction after process restart
- partial result browsing before completion

### 6.5 Crawl Job Status Model

Each crawl job should expose statuses like:

- `queued`
- `running`
- `paused`
- `cancelling`
- `cancelled`
- `completed`
- `failed`

Each page result inside a crawl should expose:

- `success`
- `partial`
- `failed`
- `blocked`
- `robots-denied`
- `skipped-duplicate`
- `skipped-filtered`

---

## 7. CLI Interface

### 7.1 Command Structure

```text
shuvcrawl <command> [options]

Commands:
  scrape <url> [urls...]     Scrape one or more URLs
  crawl <url>                Crawl a website starting from URL
  extract <prompt>           Extract structured data using LLM
  map <url>                  Discover URLs without full content extraction
  screenshot <url>           Capture a screenshot
  pdf <url>                  Render a page as PDF
  config                     Show or edit configuration
  update-bpc                 Update or inspect the BPC extension source
  cache <subcommand>         Cache maintenance/status
  version                    Show version info
```

Global options:

- `--output, -o <path>`
- `--format, -f <fmt>`
- `--json`
- `--no-cache`
- `--no-fast-path`
- `--no-bpc`
- `--proxy <url>`
- `--user-agent <ua>`
- `--wait <strategy>`
- `--wait-for <selector>`
- `--wait-timeout <ms>`
- `--sleep <ms>`
- `--debug-artifacts`
- `--config <path>`
- `--verbose`
- `--quiet`

### 7.2 `scrape`

```text
shuvcrawl scrape <url> [urls...]
```

Options:

- `--only-main-content`
- `--include-tags <sel>`
- `--exclude-tags <sel>`
- `--selector <sel>`
- `--js-eval <code>`
- `--headers <json|str>`
- `--auth <user:pass>` — HTTP Basic Auth only
- `--mobile`
- `--batch <file>`
- `--workers <n>` — reserved for future multi-worker mode; V1 behaves as 1
- `--timing`
- `--fields <list>`
- `--raw-html`
- `--debug-artifacts`

### 7.3 `crawl`

```text
shuvcrawl crawl <url>
```

Primary options:

- `--depth <n>`
- `--limit <n>`
- `--include <glob>`
- `--exclude <glob>`
- `--delay <ms>`
- `--respect-robots`
- `--source <links|sitemap|both>`
- `--resume`
- `--debug-artifacts`

### 7.4 `map`

`map` is explicitly defined as a **URL discovery** command, not a content extraction command.

Behavior:

- fetch seed page and/or sitemap as needed
- discover URLs
- normalize and filter them
- emit discovered URLs + metadata
- do **not** write full article markdown/json by default

### 7.5 `screenshot` and `pdf`

These commands are first-class debug/archive tools, not afterthoughts.

`screenshot`:

- returns path and metadata for an image capture
- supports full-page vs viewport capture
- may reuse the same browser/BPC render flow as `scrape`

`pdf`:

- produces a PDF artifact for archival/debug use
- records source URL, final URL, and render timing

### 7.6 Output Format

**Markdown to stdout (default):**

```bash
shuvcrawl scrape https://example.com/article
```

**JSON envelope:**

```bash
shuvcrawl scrape https://example.com/article --json
```

```json
{
  "data": {
    "url": "https://example.com/article",
    "content": "# Article Title\n\nArticle body...",
    "metadata": {}
  },
  "meta": {
    "requestId": "req_abc123",
    "format": "markdown",
    "elapsed": 2341,
    "bypassMethod": "bpc-extension"
  }
}
```

**Batch NDJSON:**

```bash
shuvcrawl scrape --batch urls.txt --json
```

### 7.7 Exit Codes

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
| 8 | Browser/extension initialization failed |

---

## 8. REST API

### 8.1 Server

```bash
shuvcrawl serve [--port 3777] [--host 0.0.0.0]
```

Starts an HTTP server exposing the same capabilities as the CLI.

### 8.2 Authentication

Optional bearer token auth for remote access:

```jsonc
{
  "api": {
    "token": "your-secret-token",
    "rateLimit": 60
  }
}
```

### 8.3 Endpoints

#### `POST /scrape`

```json
{
  "url": "https://example.com/article",
  "options": {
    "format": "markdown",
    "onlyMainContent": true,
    "includeTags": ["article"],
    "excludeTags": ["nav", "footer"],
    "waitStrategy": "networkidle",
    "waitFor": ".article-body",
    "waitTimeout": 30000,
    "noFastPath": false,
    "noBpc": false,
    "mobile": false,
    "headers": {},
    "auth": null,
    "proxy": null,
    "userAgent": null,
    "debugArtifacts": false
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "url": "https://example.com/article",
    "content": "# Article Title\n\n...",
    "html": "<article>...</article>",
    "metadata": {}
  },
  "meta": {
    "requestId": "req_abc123",
    "elapsed": 2341,
    "bypassMethod": "bpc-extension"
  }
}
```

#### `POST /scrape/batch`

```json
{
  "urls": ["https://a.com/1", "https://b.com/2"],
  "options": {}
}
```

V1 can process sequentially while preserving input order. The API shape should not preclude future parallelization.

#### `POST /crawl`

```json
{
  "url": "https://docs.example.com",
  "options": {
    "depth": 3,
    "limit": 100,
    "include": ["https://docs.example.com/**"],
    "exclude": ["**/changelog/**"],
    "format": "markdown",
    "delay": 1000,
    "source": "both"
  }
}
```

Response:

```json
{
  "success": true,
  "job": {
    "jobId": "crawl_a1b2c3d4",
    "status": "queued"
  }
}
```

#### `GET /crawl/:jobId`

Returns crawl status and paginated per-page results.

Query params:

- `limit`
- `offset`
- `status`

Response shape should include:

- top-level job status
- summary counts
- timestamps
- page result items
- path to crawl state/output when applicable

#### `DELETE /crawl/:jobId`

Marks a running crawl for cancellation and returns updated job status.

#### `POST /extract`

Structured LLM extraction on scraped or newly-fetched content.

#### `POST /map`

URL discovery only.

#### `GET /health`

Returns:

- service status
- active config summary (redacted)
- browser availability
- BPC version and source mode
- telemetry/exporter status

### 8.4 Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "EXTRACTION_FAILED",
    "message": "Readability could not extract content from the page",
    "details": {}
  },
  "meta": {
    "requestId": "req_abc123"
  }
}
```

Error codes:

- `INVALID_REQUEST`
- `NETWORK_ERROR`
- `TIMEOUT`
- `EXTRACTION_FAILED`
- `ROBOTS_DENIED`
- `LLM_ERROR`
- `RATE_LIMITED`
- `CONFIG_ERROR`
- `BROWSER_INIT_FAILED`
- `INTERNAL_ERROR`

---

## 9. Configuration

### 9.1 Config File

`~/.shuvcrawl/config.json` (or `$SHUVCRAWL_CONFIG`):

```jsonc
{
  "output": {
    "dir": "./output",
    "format": "markdown",
    "includeMetadata": true,
    "metaLog": true,
    "writeArtifactsOnFailure": true
  },

  "browser": {
    "headless": true,
    "executablePath": null,
    "args": [],
    "defaultTimeout": 30000,
    "viewport": { "width": 1920, "height": 1080 },
    "profileRoot": "~/.shuvcrawl/browser",
    "templateProfile": "~/.shuvcrawl/browser/template",
    "runtimeProfile": "~/.shuvcrawl/browser/runtime",
    "resetOnStart": false
  },

  "bpc": {
    "enabled": true,
    "sourceMode": "bundled",
    "path": "./bcp-clean",
    "source": null,
    "mode": "conservative",
    "enableUpdatedSites": true,
    "enableCustomSites": false,
    "excludeDomains": [],
    "storageOverrides": {}
  },

  "fastPath": {
    "enabled": true,
    "userAgent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "referer": "https://www.google.com/",
    "minContentLength": 500
  },

  "extraction": {
    "selectorOverrides": {},
    "stripSelectors": [
      "nav", "footer", "header",
      ".advertisement", ".ad-container",
      "[data-ad]", ".social-share",
      ".related-articles", ".newsletter-signup"
    ],
    "minConfidence": 0.5
  },

  "artifacts": {
    "enabled": true,
    "dir": "./output/_artifacts",
    "onFailure": true,
    "includeRawHtml": false,
    "includeCleanHtml": true,
    "includeScreenshot": true,
    "includeConsole": true
  },

  "llm": {
    "endpoint": null,
    "model": null,
    "apiKey": null,
    "maxTokens": 4096,
    "temperature": 0
  },

  "proxy": {
    "url": null,
    "rotatePerRequest": false
  },

  "api": {
    "port": 3777,
    "host": "0.0.0.0",
    "token": null,
    "rateLimit": 0
  },

  "cache": {
    "enabled": true,
    "ttl": 3600,
    "dir": "~/.shuvcrawl/cache",
    "cacheFailures": false,
    "staleOnError": false
  },

  "crawl": {
    "defaultDepth": 3,
    "defaultLimit": 50,
    "delay": 1000,
    "respectRobots": true
  },

  "telemetry": {
    "logs": true,
    "logLevel": "info",
    "otlpHttpEndpoint": null,
    "serviceName": "shuvcrawl",
    "exporter": "otlp-http"
  }
}
```

### 9.2 Environment Variable Overrides

All config values may be overridden via `SHUVCRAWL_{SECTION}_{KEY}`.

Examples:

- `SHUVCRAWL_API_PORT=8080`
- `SHUVCRAWL_API_TOKEN=secret123`
- `SHUVCRAWL_LLM_ENDPOINT=http://localhost:11434/v1`
- `SHUVCRAWL_PROXY_URL=socks5://localhost:1080`
- `SHUVCRAWL_BPC_ENABLED=false`
- `SHUVCRAWL_BROWSER_RUNTIMEPROFILE=/tmp/shuvcrawl-profile`

---

## 10. Output Format

### 10.1 Directory Structure

```text
./output/
  └── {domain}/
      ├── {slug}.md
      ├── {slug}.json
      ├── _meta.jsonl
      ├── _crawl-state.json
      └── artifacts/
          └── {requestId}/
              ├── raw.html
              ├── clean.html
              ├── page.png
              ├── page.pdf
              ├── console.json
              └── trace.json
```

### 10.2 Slug Generation

- sanitize URL path into filesystem-safe slug
- `https://example.com/` → `index`
- collisions resolved with numeric suffix
- max slug length 200 chars, truncated with hash suffix when needed

### 10.3 JSON Output Schema

```typescript
interface ScrapeResult {
  url: string;
  originalUrl: string;
  content: string;
  html: string;
  rawHtml?: string;
  metadata: ScrapeMetadata;
  artifacts?: {
    requestId: string;
    dir: string | null;
    screenshot?: string | null;
    pdf?: string | null;
  };
}
```

### 10.4 Metadata Log (`_meta.jsonl`)

Append one summary record per scrape:

```jsonl
{"requestId":"req_1","url":"https://example.com/article-1","scrapedAt":"2026-03-27T14:30:00Z","bypassMethod":"fast-path","elapsed":342,"wordCount":1205,"status":"success"}
{"requestId":"req_2","url":"https://example.com/article-2","scrapedAt":"2026-03-27T14:30:02Z","bypassMethod":"bpc-extension","elapsed":3102,"wordCount":890,"status":"partial"}
```

---

## 11. Docker Deployment

### 11.1 Dockerfile

```dockerfile
FROM oven/bun:latest

RUN apt-get update && apt-get install -y \
    libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 \
    libxdamage1 libxrandr2 libgbm1 libasound2 \
    libpangocairo-1.0-0 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
RUN bunx patchright install chromium
COPY . .
EXPOSE 3777
CMD ["bun", "run", "src/server.ts"]
```

### 11.2 Docker Compose

```yaml
version: "3.8"
services:
  shuvcrawl:
    build: .
    ports:
      - "3777:3777"
    volumes:
      - ./output:/app/output
      - shuvcrawl-data:/root/.shuvcrawl
    environment:
      - SHUVCRAWL_API_TOKEN=${SHUVCRAWL_API_TOKEN:-}
      - SHUVCRAWL_LLM_ENDPOINT=${SHUVCRAWL_LLM_ENDPOINT:-}
      - SHUVCRAWL_LLM_MODEL=${SHUVCRAWL_LLM_MODEL:-}
      - SHUVCRAWL_LLM_API_KEY=${SHUVCRAWL_LLM_API_KEY:-}
      - SHUVCRAWL_TELEMETRY_OTLPHTTPENDPOINT=${SHUVCRAWL_TELEMETRY_OTLPHTTPENDPOINT:-}
    restart: unless-stopped
    security_opt:
      - seccomp=unconfined
    shm_size: "2gb"

volumes:
  shuvcrawl-data:
```

### 11.3 Runtime Notes

The deployment must support whatever Chromium mode is required for extension compatibility in the target environment. If headed Chromium under a virtual display is required, that should be documented and supported explicitly rather than assumed away.

---

## 12. Proxy Support

### 12.1 Scope

Not the highest-priority V1 differentiator, but the plumbing should exist from day one.

### 12.2 Implementation

Patchright/Playwright proxy settings are passed through directly. Supported schemes include HTTP and SOCKS5.

### 12.3 Future: Rotation

Future versions may introduce a `ProxyProvider` abstraction for rotation, health, and failure reporting.

---

## 13. Caching

### 13.1 Response Cache

File-based cache keyed on normalized URL and relevant option state.

- default TTL: 1 hour
- storage: `~/.shuvcrawl/cache/{url-hash}.json`
- `--no-cache` bypasses reads
- cache clear/status maintenance commands are supported

### 13.2 Cache Key

The cache key must include every request dimension that materially changes output, including at minimum:

- normalized requested URL
- output format
- selector overrides / include/exclude selectors
- mobile vs desktop
- fast-path enabled/disabled
- BPC enabled/disabled
- significant request headers / auth state when relevant
- proxy identity if it materially changes access behavior

### 13.3 Cache Behavior Rules

- redirect final URL should be recorded in metadata, but not silently collapse all requested URLs into one cache entry unless explicitly designed
- canonical URL is metadata, not the sole cache identity
- failures are not cached by default
- optional stale-on-error behavior may return expired successful cache entries when live fetch fails

---

## 14. Testing Strategy

### 14.1 Unit Tests

- content extraction pipeline
- URL normalization and slug generation
- config loading and env overrides
- cache key generation and TTL behavior
- BPC config adapter mapping
- CLI parsing

### 14.2 Integration Tests

- scrape pipeline against local fixture pages
- BPC extension load + readiness verification
- fast-path vs browser-render path selection
- artifacts capture behavior
- REST API endpoint behavior
- crawl state persistence and resume

### 14.3 Live Tests (Optional, CI-excluded)

- known paywalled targets
- anti-bot test targets
- browser/extension compatibility smoke tests

### 14.4 Telemetry Tests

- structured log shape validation
- request/crawl correlation IDs
- OTLP exporter smoke test when configured

### 14.5 Test Runner

Use Bun’s built-in test runner.

---

## 15. Project Structure

```text
shuvcrawl/
├── package.json
├── bun.lockb
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── README.md
├── LICENSE
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── core/
│   │   ├── engine.ts
│   │   ├── browser.ts
│   │   ├── bpc.ts
│   │   ├── scraper.ts
│   │   ├── crawler.ts
│   │   ├── extractor.ts
│   │   ├── converter.ts
│   │   ├── metadata.ts
│   │   ├── fast-path.ts
│   │   └── llm.ts
│   ├── api/
│   │   ├── routes.ts
│   │   ├── middleware.ts
│   │   └── schemas.ts
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── scrape.ts
│   │   │   ├── crawl.ts
│   │   │   ├── extract.ts
│   │   │   ├── map.ts
│   │   │   ├── screenshot.ts
│   │   │   ├── pdf.ts
│   │   │   ├── config.ts
│   │   │   ├── cache.ts
│   │   │   └── update-bpc.ts
│   │   └── output.ts
│   ├── storage/
│   │   ├── output.ts
│   │   ├── cache.ts
│   │   ├── crawl-state.ts
│   │   └── artifacts.ts
│   ├── config/
│   │   ├── schema.ts
│   │   ├── loader.ts
│   │   └── defaults.ts
│   └── utils/
│       ├── url.ts
│       ├── retry.ts
│       ├── logger.ts
│       ├── telemetry.ts
│       ├── robots.ts
│       └── proxy.ts
├── tests/
│   ├── fixtures/
│   ├── unit/
│   └── integration/
└── scripts/
    └── fetch-bpc.sh
```

---

## 16. V1 Scope and Milestones

### 16.1 V1.0 (MVP)

Must have:

- [ ] Single-URL scrape via CLI and REST API
- [ ] Patchright browser launch with stealth defaults
- [ ] BPC extension loaded into browser context
- [ ] Extension readiness verification before first navigation
- [ ] Explicit browser profile strategy (template + runtime profile)
- [ ] BPC config adapter and excluded-domain support
- [ ] Fast-path HTTP fetch (Googlebot UA + Google referer)
- [ ] Content extraction (Readability + selector fallback + full body)
- [ ] HTML → Markdown conversion (Turndown)
- [ ] Metadata extraction (title, author, date, OG, LD+JSON)
- [ ] File output (markdown + JSON sidecar + meta log)
- [ ] Debug artifact capture on failure
- [ ] Response cache (file-based, configurable TTL)
- [ ] robots.txt parsing and respect
- [ ] Config file + env var overrides
- [ ] Per-domain polite delay / rate limiting
- [ ] Structured JSON logging and request/job correlation IDs
- [ ] Basic OTLP instrumentation hooks
- [ ] Docker Compose deployment
- [ ] Basic REST API with auth token support
- [ ] `scrape`, `map`, `screenshot`, `pdf` commands
- [ ] `--proxy` passthrough to Patchright

### 16.2 V1.1

- [ ] Crawl orchestration (BFS, depth/limit, include/exclude patterns)
- [ ] Crawl state persistence and `--resume`
- [ ] Sitemap discovery
- [ ] Batch scrape with NDJSON output
- [ ] `shuvcrawl crawl` CLI and `POST /crawl` endpoint
- [ ] Crawl API status pagination and cancellation

### 16.3 V1.2

- [ ] LLM structured extraction (`shuvcrawl extract` + `POST /extract`)
- [ ] Persistent custom selector hints per domain
- [ ] Optional stale-on-error cache behavior
- [ ] Webhook notifications on crawl completion

### 16.4 V2.0 (Future)

- [ ] Browser pool (configurable concurrency)
- [ ] Per-worker isolated profiles
- [ ] Proxy rotation with `ProxyProvider`
- [ ] Scheduled/recurring crawls
- [ ] Change detection / diffing against previous scrape
- [ ] MCP server interface

---

## 17. Open Questions

These remain intentionally unresolved and should be addressed in the next pass / PRD.

1. **BPC runtime source of truth**: Should shuvcrawl treat the in-repo `bcp-clean/` fork as the default runtime source, or should the canonical model be a managed install under `~/.shuvcrawl/extensions/bpc/`?

2. **Update ownership**: In bundled mode, should `update-bpc` be read-only/status-only, or should it be allowed to mutate the checked-out fork on disk?

3. **Conservative vs aggressive BPC defaults**: Should V1 default to upstream-like conservative behavior, or should it opt into broader custom/updated site support automatically?

4. **Optional host permissions strategy**: How should shuvcrawl handle domains that require optional host permissions in the current BPC fork? Can those be safely granted/seeded automatically in Chromium, or do they require a separate runtime mode?

5. **Browser execution mode**: Can the target Patchright/Chromium stack load MV3 extensions reliably in headless mode for this use case, or should the official Docker path use headed Chromium under a virtual display?

6. **Profile isolation model**: Should the default runtime reuse one long-lived runtime profile, or should each scrape/crawl session start from a fresh copy of a clean template profile?

7. **Readability on Bun**: Does `@mozilla/readability` + `jsdom` behave well enough under Bun for production use, or should extraction run in-page or via an alternative DOM implementation?

8. **Cache identity details**: Which request headers or runtime knobs should be considered cache-key-relevant in V1 beyond the obvious URL/format/selector/mobile flags?

9. **Failure caching policy**: Is there any case where blocked/partial/failure results should be cached, or should failures always force a live retry?

10. **Canonical URL semantics**: Should canonical URL ever replace the requested URL as the primary output identity, or should it remain metadata only?

11. **`map` implementation boundary**: Should `map` remain strictly lightweight discovery, or may it use rendered pages/BPC on sites where sitemap/link discovery otherwise fails?

12. **Artifacts default policy**: Should screenshots/raw HTML be captured only on failure, or should they be first-class optional outputs for every scrape in V1?

13. **Telemetry export default**: Should OTLP export be enabled by default when Maple Ingest is reachable, or should telemetry remain local-logs-only unless explicitly configured?

14. **API job durability**: Is disk-backed crawl state sufficient for API job persistence, or is a separate job registry needed even in V1?

15. **Legal/distribution posture**: If BPC mirrors disappear or move again, does shuvcrawl want a multi-mirror resolver, a pinned maintained fork, or a strictly user-provided extension path?

---

## 18. Non-Goals

To be explicit about what shuvcrawl does **not** aim to do:

- **Account-based login flows** — no support for username/password login forms, OAuth, SSO, or session orchestration for subscriber-only hard paywalls
- **General web-app automation** — not intended for dashboards, admin panels, or arbitrary SPA interaction beyond what is needed for article extraction
- **Distributed crawling** — single-host only in V1
- **Search/index product features** — shuvcrawl writes outputs; indexing/searching is someone else’s job
- **Compliance automation for every target site** — the user is responsible for how they use the tool and which sites they target
