# Plan: shuvcrawl MVP Completion

**Objective:** Complete all remaining work to reach a fully testable V1.0 MVP per `shuvcrawl-spec.md` §16.1, plus the crawl-related scope from §16.2 that is already partially implemented.

**Baseline:** The app has working `scrape`, `map`, `crawl` (skeleton), `screenshot`, `pdf`, `config`, `version`, `health` via CLI + REST. Error classification, exit codes, auth middleware, and structured logging are in place. `bun run typecheck` and `bun test` (23 tests) pass.

**Spec scope note:** The spec organizes V1 into V1.0 (MVP) and V1.1 (crawl/batch/sitemap). Because crawl and map are already partially implemented, this plan finishes both V1.0 and V1.1 scope in one pass. LLM extraction (V1.2) and browser pool concurrency (V2.0) are explicitly **out of scope**.

---

## Known design constraints to keep in mind

These cross-cutting issues affect multiple tasks and must be respected throughout.

### D1. Browser session lifecycle is per-request

`BrowserPool.acquire()` creates a new persistent context from the template profile on every call, and `release()` tears it down. This means crawls pay full browser startup/teardown per page. V1 accepts this cost — fixing it requires a multi-page session model that belongs in V2 browser-pool work. All tasks in this plan must work within this constraint.

### D2. `scraper.ts` has a browser session leak on error

In `src/core/scraper.ts`, `browser.release()` is called at the end of the success path but is **not** inside a `try/finally`. If an error occurs between `acquire()` and `release()`, the session leaks and the runtime profile directory is orphaned. Compare with `src/core/capture.ts` which correctly uses `try/finally`. **Task 1.0 fixes this before any other pipeline changes.**

### D3. Crawl delay must not double-stack

The crawl loop in `src/core/crawl.ts` has an explicit `await delay(crawlDelay)` between iterations. When we add a global per-domain rate limiter (task 1.4), the crawl loop's explicit delay must be **replaced** by the rate limiter, not layered on top of it. The rate limiter must count both `scrapeUrl()` and `mapUrl()` calls as requests to the same domain.

### D4. CLI crawl stays synchronous, API crawl becomes async

The CLI `crawl` command should block until the crawl completes (with progress output). The API `POST /crawl` must return immediately with `{ jobId, status: 'running' }` and run the crawl in the background. Task 2.3 addresses this split explicitly.

---

## Phase 0 — Prerequisite fix

### 0.1 Fix browser session leak in scraper.ts

**File:** `src/core/scraper.ts`

- [ ] Wrap the browser-render block in `try/finally` so `browser.release()` always runs, matching the pattern already used in `capture.ts`
- [ ] Move the screenshot capture inside the existing `browserStage` or into a separate try block that still guarantees release

This must land before any other scraper changes to prevent leak surface from growing.

---

## Phase 1 — Core pipeline gaps

These tasks fix missing behavior in the scrape pipeline itself — the foundation everything else builds on.

Tasks 1.1, 1.2, 1.3, and 1.4 are independent of each other and can be parallelized.

### 1.1 Real robots.txt parsing

**File:** `src/utils/robots.ts`

Currently a stub that always returns `{ allowed: true }`. The spec requires robots.txt parsing with configurable respect.

- [ ] Add a lightweight robots.txt fetcher (fetch `{origin}/robots.txt`, cache result in memory for the process lifetime keyed by origin)
- [ ] Parse `User-agent` and `Disallow` / `Allow` directives for our configured user-agent
- [ ] Return `{ allowed: false, reason: 'robots.txt: Disallow /path' }` when blocked
- [ ] Respect the `config.crawl.respectRobots` toggle (when false, skip entirely)
- [ ] Handle fetch errors gracefully (network failure on robots.txt = allowed, per convention)
- [ ] Add unit tests: allowed path, disallowed path, missing robots.txt, `respectRobots: false`
- [ ] Add a `--no-robots` global CLI option that overrides `respectRobots` to false for individual commands

**Test file:** `tests/unit/robots.test.ts`

### 1.2 File-based response cache

**Files:** `src/storage/cache.ts` (rewrite), `src/core/scraper.ts` (integrate)

Currently only a cache-key builder exists. Spec §13 requires a file-based cache with configurable TTL.

- [ ] Hash the existing `buildCacheKey()` JSON output with SHA-256 (truncated to 16 hex chars) to produce a filesystem-safe filename
- [ ] Store cache entries at `{expandedCacheDir}/{hash}.json` with the structure: `{ key, cachedAt, result }`
- [ ] Store the full key string inside the cache file so hash collisions can be detected on read
- [ ] Implement `readCache(cacheDir, key, ttl)` → returns cached `ScrapeResult` if key matches and `cachedAt + ttl > now`, else null
- [ ] Implement `writeCache(cacheDir, key, result)` → writes the entry
- [ ] Implement `listCache(cacheDir)` and `clearCache(cacheDir, olderThan?)` for the `cache` CLI subcommand
- [ ] Integrate into `scrapeUrl()`: check cache before fast-path/browser render, write cache after success
- [ ] Respect `config.cache.enabled` and `config.cache.cacheFailures`
- [ ] CLI `--no-cache` flag on `scrape` command bypasses cache reads (thread through `ScrapeOptions`)
- [ ] Add unit tests: cache hit, cache miss, TTL expiry, hash collision detection, `--no-cache` bypass, disabled cache

**Test file:** `tests/unit/cache.test.ts` (expand existing)

### 1.3 Collision-safe output slugging

**File:** `src/utils/url.ts` (update `slugFromUrl`), `src/storage/output.ts`

Spec §10.2 requires collision-safe slugs with numeric suffix and hash truncation.

- [ ] In `writeScrapeOutput()`: after computing slug, check if `{slug}.json` already exists; if so, read the first line to compare the stored URL
- [ ] If collision detected (different URL, same slug), append `-1`, `-2`, etc. until unique
- [ ] If slug exceeds 200 chars, truncate at 192 chars and append `-` + 7-char hex hash of the full path
- [ ] Add unit tests for slug collision resolution and long-URL truncation

**Test file:** `tests/unit/url.test.ts`

### 1.4 Per-domain polite delay / rate limiter

**File:** new `src/utils/rate-limit.ts`, integrate into `src/core/engine.ts`

Spec §4.2 requires per-domain delay. The crawl skeleton has its own delay loop that must be replaced.

- [ ] Implement `DomainRateLimiter` class with an in-memory `Map<hostname, lastRequestTimestamp>`
- [ ] Method: `async waitForDomain(hostname: string, delayMs: number)` — sleeps if needed, then updates timestamp
- [ ] Instantiate one `DomainRateLimiter` in `Engine` and pass it to `scrapeUrl()`, `mapUrl()`, `captureScreenshot()`, `renderPdf()`
- [ ] Each pipeline function calls `rateLimiter.waitForDomain(hostname, config.crawl.delay)` before the fetch/render step
- [ ] **Remove** the explicit `await delay(crawlDelay)` from `src/core/crawl.ts` — the rate limiter now handles it
- [ ] No delay needed on the very first request to a domain
- [ ] Add unit test for delay calculation logic (mock timers)

**Test file:** `tests/unit/rate-limit.test.ts`

### 1.5 Wait strategy support

**Files:** `src/core/scraper.ts`, `src/core/capture.ts`, `src/api/schemas.ts`, CLI command files

Spec §4.5 defines wait strategies (`load`, `networkidle`, `selector`, `sleep`) as V1.0 core features. Currently hardcoded to `waitUntil: 'load'`.

- [ ] Add wait strategy options to `ScrapeOptions`: `wait?: 'load' | 'networkidle' | 'selector' | 'sleep'`, `waitFor?: string` (selector), `waitTimeout?: number`, `sleep?: number`
- [ ] In `scrapeUrl()` browser-render block: use `page.goto()` with `waitUntil` matching the strategy, then optionally `page.waitForSelector(waitFor)` or `page.waitForTimeout(sleep)`
- [ ] Apply the same wait logic in `captureScreenshot()` and `renderPdf()`
- [ ] Record the actual wait strategy used in `metadata.waitStrategy` (currently always `'load'`)
- [ ] Add to `ScrapeRequestSchema`: `waitStrategy`, `waitFor`, `waitTimeout`, `sleep`
- [ ] Add to `ScreenshotRequestSchema` and `PdfRequestSchema`: same wait fields
- [ ] Add CLI options to `scrape`: `--wait <strategy>`, `--wait-for <selector>`, `--wait-timeout <ms>`, `--sleep <ms>`
- [ ] Add CLI options to `screenshot` and `pdf`: same

### 1.6 Scrape-specific CLI/API option wiring

**Files:** `src/cli/commands/scrape.ts`, `src/core/scraper.ts`, `src/api/schemas.ts`

Spec §7.2 and §8.3 define options that are missing from the current CLI and API schemas.

Must-have for V1.0:
- [ ] `--headers <json>` — pass custom headers to both fast-path fetch and browser context
- [ ] `--mobile` — set mobile viewport (use a sensible mobile preset like 390×844)
- [ ] `--raw-html` — include raw HTML in JSON output (sets `config.artifacts.includeRawHtml` per-request)
- [ ] `--only-main-content` — hint to extraction layer (currently Readability does this by default; make it explicit and wire the opposite as `--no-only-main-content` which would use full-body)
- [ ] Add corresponding fields to `ScrapeRequestSchema`: `headers`, `mobile`, `rawHtml`, `onlyMainContent`
- [ ] Thread `headers` through to `tryFastPath()` and browser context `setExtraHTTPHeaders()`
- [ ] Thread `mobile` through to browser context viewport override

Deferred to post-MVP (note in code):
- `--js-eval` (requires `page.evaluate()` injection support)
- `--auth` (HTTP basic auth)
- `--include-tags` / `--exclude-tags` (selector-based content filtering beyond `--selector`)
- `--batch` (batch mode)

---

## Phase 2 — Crawl completion

### 2.1 Crawl resume from disk state

**Files:** `src/core/crawl.ts`, `src/storage/crawl-state.ts`

The crawl skeleton writes state but never reads it back.

- [ ] Add `loadCrawlState(outputDir, hostname)` function to `crawl-state.ts` that reads and parses `_crawl-state.json`
- [ ] On `crawlSite()` entry, if `options.resume` is true, check for existing state file
- [ ] If found, restore `visited` set, `queue`, and `results` from the saved state
- [ ] Validate the restored state's seed URL and options match the current request (warn if they diverge)
- [ ] Skip already-visited URLs and continue from the queued frontier
- [ ] Add resume-specific unit test with a mock state file on disk (use a tmp dir)

**Test file:** `tests/unit/crawl-state.test.ts`

### 2.2 Sitemap discovery

**File:** new `src/core/sitemap.ts`, integrate into `src/core/discovery.ts` and `src/core/map.ts` / `src/core/crawl.ts`

Spec §6.3 requires sitemap parsing when `source` is `sitemap` or `both`.

- [ ] Use `jsdom`'s DOMParser (already a dependency) to parse sitemap XML — no new dependency needed
- [ ] Fetch `{origin}/sitemap.xml`; if it's a `<sitemapindex>`, follow child `<sitemap><loc>` entries one level deep
- [ ] Parse `<url><loc>...</loc></url>` entries from each sitemap
- [ ] Return `DiscoveredUrl[]` with `source: 'sitemap'`
- [ ] Add `'sitemap'` to the `LinkSource` type union in `src/core/discovery.ts`
- [ ] In `mapUrl()`: accept a `source` option; when `sitemap` or `both`, merge sitemap URLs with page-link discovery
- [ ] In `crawlSite()`: when `options.source` is `sitemap` or `both`, seed the initial queue from sitemap discovery before BFS
- [ ] Handle missing/malformed sitemaps gracefully (warn and continue with page links only)
- [ ] Add unit test with fixture sitemap XML strings (valid, index, malformed)

**Fixture files:** `tests/fixtures/sitemap.xml`, `tests/fixtures/sitemap-index.xml`
**Test file:** `tests/unit/sitemap.test.ts`

### 2.3 Async crawl API + job registry

This is split into two subtasks because the architectural change (2.3a) is the hard part and must land before the routes (2.3b).

#### 2.3a Make `POST /crawl` non-blocking

**Files:** new `src/core/job-registry.ts`, `src/core/engine.ts`, `src/core/crawl.ts`, `src/api/routes.ts`

- [ ] Create `JobRegistry` class: in-memory `Map<jobId, { status, statePath?, hostname, promise, cancel: () => void, error? }>`
- [ ] Add a cancellation mechanism to `crawlSite()`: accept an `AbortSignal`-compatible flag, check it at the top of each loop iteration, set `status: 'cancelled'` and break if aborted
- [ ] Refactor `Engine.crawl()`:
  - Generate the jobId and hostname up front
  - Register the job in the registry with status `'running'`
  - Fire-and-forget the `crawlSite()` promise (catch errors, record them in registry, set status `'failed'`)
  - On successful completion, update registry status to `'completed'`
  - Return `{ jobId, status: 'running' }` immediately
- [ ] Instantiate `JobRegistry` in the `Engine` constructor
- [ ] Update `POST /crawl` route to return `{ success: true, job: { jobId, status } }` from the synchronous result
- [ ] **CLI `crawl` command stays synchronous**: call a new `Engine.crawlSync()` method (or await the promise directly) so the CLI blocks until completion

#### 2.3b Add crawl status and cancellation routes

**Files:** `src/api/routes.ts`, `src/core/engine.ts`

- [ ] `Engine.getCrawlJob(jobId)` — read from registry, fall back to scanning disk state files
- [ ] `Engine.cancelCrawl(jobId)` — set the abort flag; the crawl loop picks it up next iteration
- [ ] `GET /crawl/:jobId` — returns job status, summary counts, and optionally paginated results (query params: `limit`, `offset`)
- [ ] `DELETE /crawl/:jobId` — calls `cancelCrawl()`, returns updated status
- [ ] 404 if jobId not found in registry or on disk
- [ ] Add route tests with a mock engine

**Test file:** `tests/unit/routes-crawl-status.test.ts`

### 2.4 Crawl CLI progress output

**File:** `src/cli/commands/crawl.ts`

Currently crawl blocks until complete and prints one JSON blob. For usability:

- [ ] In non-JSON mode, print a progress line per page to stderr: `[depth] status url elapsed`
- [ ] This requires `crawlSite()` to accept an `onPageComplete` callback (or return an async iterator/emitter)
- [ ] Final summary line at end to stdout: `completed: visited=N succeeded=N failed=N skipped=N statePath=...`
- [ ] In JSON mode, continue to print the full result JSON to stdout at the end

---

## Phase 3 — Missing CLI/API plumbing

### 3.1 `serve` command in CLI

**Files:** new `src/api/start-server.ts` (shared logic), new `src/cli/commands/serve.ts`, update `src/server.ts`, update `src/index.ts`

The spec defines `shuvcrawl serve [--port] [--host]` as the way to start the REST server.

- [ ] Extract server-start logic into `src/api/start-server.ts`: takes engine + config, returns the `Bun.serve()` handle
- [ ] `src/cli/commands/serve.ts`: `serve` subcommand accepting `--port` and `--host` (defaulting from config), calls shared start function
- [ ] `src/server.ts`: rewrite to import and call the same shared start function (convenience entrypoint kept for `bun run src/server.ts`)
- [ ] Update `package.json` script: `"serve": "bun run src/index.ts serve"`
- [ ] Register in `src/index.ts`

### 3.2 `cache` subcommand

**File:** new `src/cli/commands/cache.ts`

Spec §7.1 lists `cache <subcommand>` for maintenance/status. Depends on 1.2 (cache rewrite).

- [ ] `shuvcrawl cache status` — print cache dir, total entries, total size on disk
- [ ] `shuvcrawl cache clear` — remove all cached files
- [ ] `shuvcrawl cache clear --older-than <seconds>` — remove entries older than threshold
- [ ] Uses `listCache()` and `clearCache()` from `src/storage/cache.ts`
- [ ] `--json` for structured output
- [ ] Register in `src/index.ts`

### 3.3 `update-bpc` subcommand

**File:** new `src/cli/commands/update-bpc.ts`

Spec §3.8 requires source inspection/reporting. Reuses `readBpcManifest()` from `src/core/capture.ts`.

- [ ] `bundled` mode: report version from manifest, warn that updates are repo-managed
- [ ] `managed` mode: stub with message "managed mode not yet implemented"
- [ ] `custom` mode: validate configured path exists, report version if manifest found
- [ ] `--json` for structured output
- [ ] Register in `src/index.ts`

### 3.4 Global CLI options

**File:** `src/index.ts`, CLI command files

The spec lists global options that are currently missing from the commander setup.

- [ ] Add global options to the program root: `--output`, `--format`, `--no-cache`, `--no-robots`, `--proxy`, `--user-agent`, `--verbose`, `--quiet`, `--config`
- [ ] `--proxy` threaded into engine calls (browser pool already supports it, just needs CLI wiring)
- [ ] `--verbose` sets log level to `debug`; `--quiet` sets log level to `error`
- [ ] `--config <path>` overrides the config file path (must be read **before** `loadConfig()`)
- [ ] `--output` overrides `config.output.dir`
- [ ] `--format` overrides `config.output.format`
- [ ] `--no-cache` sets `config.cache.enabled = false`
- [ ] `--no-robots` sets `config.crawl.respectRobots = false`
- [ ] `--user-agent` overrides `config.fastPath.userAgent`

**Note:** `--config` must be parsed early. Use commander's `preAction` hook or parse argv manually before `loadConfig()`.

---

## Phase 4 — Docker deployment

### 4.1 Production Dockerfile

**File:** `Dockerfile` (project root)

Reference the spike's Docker findings in `spikes/patchright-bpc/docker/Dockerfile` for Chromium + MV3 extension requirements. The spike validated both headless and headed+Xvfb modes.

- [ ] Base image: `oven/bun:latest`
- [ ] Install Chromium system deps (libnss3, libatk-bridge2.0-0, libdrm2, libxcomposite1, libxdamage1, libxrandr2, libgbm1, libasound2, libpangocairo-1.0-0, libgtk-3-0)
- [ ] If spike showed MV3 extensions require headed mode: also install `xvfb` and use `xvfb-run` in CMD
- [ ] Install Patchright Chromium: `bunx patchright install chromium`
- [ ] Copy app source, `bun install --frozen-lockfile`
- [ ] Copy `bpc-chrome/` into the image
- [ ] Expose port 3777
- [ ] Default CMD: `bun run src/server.ts` (or `xvfb-run bun run src/server.ts` if Xvfb required)
- [ ] Validate `docker build` succeeds

### 4.2 Docker Compose

**File:** `docker-compose.yml`

Per spec §11.2:

- [ ] Service definition mounting `./output` and a named volume for `~/.shuvcrawl`
- [ ] Environment variable passthrough for `SHUVCRAWL_API_TOKEN`, `SHUVCRAWL_TELEMETRY_OTLPHTTPENDPOINT`, etc.
- [ ] `shm_size: 2gb`, `security_opt: [seccomp=unconfined]`
- [ ] `restart: unless-stopped`

### 4.3 Docker smoke test

**File:** `scripts/docker-smoke.sh`

- [ ] `docker compose up -d`
- [ ] Wait for health endpoint: `curl --retry 10 --retry-delay 2 http://localhost:3777/health`
- [ ] `POST /scrape` with `https://example.com` → verify JSON response
- [ ] `docker compose down`
- [ ] Exit 0 on success, 1 on any failure

---

## Phase 5 — Telemetry and observability

### 5.1 OTLP HTTP export stub

**File:** `src/utils/telemetry.ts` (expand)

Spec §4.9 and global AGENTS.md mandate telemetry as a day-zero requirement.

Scope this as a **Maple-Ingest-compatible** JSON exporter, not full OTLP protocol compliance. Maple Ingest (`:3474`) is the intended first hop per AGENTS.md.

- [ ] When `config.telemetry.otlpHttpEndpoint` is set, buffer completed spans in memory
- [ ] Flush spans to `{endpoint}/v1/traces` as OTLP JSON (`ExportTraceServiceRequest` shape) on a timer or at process exit
- [ ] Include resource attributes: `service.name` (from config), `service.version` (from package.json), `host.name`
- [ ] Include span attributes: `requestId`, `jobId`, `url`, `bypassMethod`, `elapsed`
- [ ] Wrap `measureStage()` to create span records when OTLP is enabled
- [ ] When OTLP is not configured, no-op (current behavior preserved)
- [ ] If Maple Ingest has a simpler ingest format than full OTLP, prefer that — add a code comment noting the assumption
- [ ] Add a test that verifies span payload shape without requiring a real collector

**Test file:** `tests/unit/telemetry.test.ts`

### 5.2 Console log artifact capture

**Files:** `src/core/browser.ts`, `src/core/scraper.ts`, `src/core/capture.ts`, `src/storage/artifacts.ts`

Spec §4.8 mentions capturing console logs as an artifact.

- [ ] In `BrowserSession`, add a `consoleLogs: Array<{ type: string, text: string, timestamp: string }>` collector
- [ ] In `BrowserPool.prepareSessionPage()`, register `page.on('console', ...)` to push messages into the collector
- [ ] In `scrapeUrl()`, `captureScreenshot()`, and `renderPdf()`: after the page work is done and before release, if `config.artifacts.includeConsole` is true and artifactDir exists, write `console.json`
- [ ] Format: `[{ type: "log"|"error"|"warning"|"info", text: "...", timestamp: "ISO" }]`

---

## Phase 6 — Test coverage to "fully testable" state

### 6.1 Unit test gaps

Add tests for currently untested modules. All tasks are independent and parallelizable.

- [ ] `tests/unit/url.test.ts` — `normalizeUrl`, `slugFromUrl` (basic + collision + truncation + hash suffix)
- [ ] `tests/unit/extractor.test.ts` — Readability path, selector override, full-body fallback, strip selectors (use fixture HTML)
- [ ] `tests/unit/converter.test.ts` — basic HTML → Markdown round-trip
- [ ] `tests/unit/metadata.test.ts` — OG/Twitter/LD+JSON extraction from fixture HTML
- [ ] `tests/unit/config-loader.test.ts` — file merge, env overrides, defaults, missing config file
- [ ] `tests/unit/fast-path.test.ts` — accepted vs rejected based on content length / status
- [ ] `tests/unit/proxy.test.ts` — `resolveProxy` with/without override
- [ ] `tests/unit/paths.test.ts` — `expandHome` edge cases

### 6.2 Integration tests

These test multi-module flows against fixture inputs without a browser.

**Dir:** `tests/integration/`

- [ ] `tests/integration/scrape-pipeline.test.ts` — feed fixture HTML through `extractDocument` → `htmlToMarkdown` → `buildMetadata` → `writeScrapeOutput`, verify output files on disk (use a tmp dir)
- [ ] `tests/integration/cache-roundtrip.test.ts` — `writeCache` a result, `readCache` it back, verify TTL expiry causes miss
- [ ] `tests/integration/crawl-state.test.ts` — `writeCrawlState`, `loadCrawlState`, verify queue/visited restoration
- [ ] `tests/integration/api-endpoints.test.ts` — create a test Hono app with a stubbed engine, verify request/response shapes for all endpoints including `/map`, `/crawl`, `/crawl/:jobId`, `/health`, `/config`

### 6.3 Fixture files

**Dir:** `tests/fixtures/`

- [ ] `article.html` — a realistic article page with OG tags, LD+JSON, `<article>` body, nav, footer, social-share
- [ ] `paywall-teaser.html` — short teaser content (< 500 chars body) for fast-path rejection testing
- [ ] `sitemap.xml` — valid sitemap with 3-5 `<url>` entries
- [ ] `sitemap-index.xml` — a `<sitemapindex>` pointing to `sitemap.xml`
- [ ] `robots.txt` — with `User-agent: *`, `Disallow: /private/`, `Allow: /public/`

---

## Phase 7 — Documentation and polish

### 7.1 README.md

**File:** `README.md`

- [ ] Project summary
- [ ] Quick start (local): `bun install && bun run scrape -- https://example.com --json`
- [ ] Quick start (Docker): `docker compose up && curl localhost:3777/health`
- [ ] CLI command reference (all subcommands with key options)
- [ ] REST API reference (endpoints, request/response shapes, auth)
- [ ] Configuration reference (config file path, key sections, env var override pattern)
- [ ] Exit codes table
- [ ] Development section: typecheck, test, serve

### 7.2 Startup profile cleanup

**File:** `src/core/browser.ts`

HANDOFF notes that runtime profile dirs accumulate if a process crashes.

- [ ] On first `BrowserPool.acquire()` call, scan the runtime profile root directory
- [ ] Remove any existing subdirectories (V1 is single-session, so any existing dirs are stale)
- [ ] Log a warning when stale profiles are cleaned (count + total size)

### 7.3 Honor `config.output.format`

**File:** `src/storage/output.ts`

Currently `writeScrapeOutput()` always writes both `.md` and `.json` regardless of the `output.format` config value.

- [ ] When `config.output.format === 'markdown'`: write both `.md` and `.json` (current behavior, markdown is primary)
- [ ] When `config.output.format === 'json'`: write `.json` only, skip `.md`
- [ ] Add a comment noting that both are always written when format is `markdown` because the JSON sidecar is useful for tooling

### 7.4 Refresh HANDOFF.md

**File:** `HANDOFF.md`

- [ ] Full rewrite reflecting MVP-complete state after all phases

---

## Task summary

| Phase | Tasks | Priority | Parallelizable within phase? |
|-------|-------|----------|------------------------------|
| 0 | Scraper session leak fix | **Must** | N/A (single task) |
| 1 | Core pipeline gaps (robots, cache, slugs, rate limit, wait strategies, scrape options) | **Must** | Yes — 1.1–1.6 are independent |
| 2 | Crawl completion (resume, sitemap, async API + registry, progress) | **Must** | 2.1 and 2.2 are independent; 2.3a before 2.3b; 2.4 after 2.3a |
| 3 | CLI/API plumbing (serve, cache cmd, update-bpc, global opts) | **Must** | 3.1–3.3 are independent; 3.4 touches all commands |
| 4 | Docker deployment | **Must** | 4.1 before 4.2 before 4.3 |
| 5 | Telemetry and observability | **Must** | 5.1 and 5.2 are independent |
| 6 | Test coverage | **Must** | All tasks are independent |
| 7 | Documentation and polish | **Should** | All tasks are independent |

## Execution order (single agent, respecting dependencies)

```
0.1 (session leak fix)
  → 1.1, 1.2, 1.3, 1.4, 1.5, 1.6  (can interleave; all independent)
    → 2.1, 2.2  (independent of each other; depend on Phase 1 being stable)
    → 2.3a → 2.3b  (async crawl API — sequential)
    → 2.4  (depends on 2.3a for callback/emitter pattern)
      → 3.1, 3.2 (3.2 depends on 1.2), 3.3  (independent)
      → 3.4  (global opts — touches all commands, do last in phase)
        → 4.1 → 4.2 → 4.3
          → 5.1, 5.2  (independent)
            → 6.1, 6.2, 6.3  (all independent, can interleave)
              → 7.1, 7.2, 7.3, 7.4  (all independent)
```

## Out of scope

Explicitly excluded from this plan (per spec milestones):

- **LLM extraction** (`extract` command, `POST /extract`, LLM config schema) — V1.2
- **Browser pool concurrency / multi-page sessions** — V2.0
- **Per-worker isolated profiles** — V2.0
- **Proxy rotation** — V2.0
- **Scheduled/recurring crawls** — V2.0
- **Change detection / diffing** — V2.0
- **MCP server interface** — V2.0
- **Batch scrape `POST /scrape/batch`** — V1.1 nice-to-have; low value without concurrency
- **Webhook notifications** — V1.2
- **`--js-eval`** — requires safe `page.evaluate()` injection; deferred to post-MVP
- **`--auth` (HTTP basic)** — low priority for V1.0 article extraction use case
- **`--include-tags` / `--exclude-tags`** — selector filtering beyond `--selector`; deferred

## Validation gates

After each phase, validate:

1. `bun run typecheck` passes
2. `bun test` passes (all existing + new tests)
3. Manual smoke: `bun run scrape -- https://example.com --json` still works
4. No regressions in CLI stdout/stderr separation
5. After Phase 4: `scripts/docker-smoke.sh` passes
