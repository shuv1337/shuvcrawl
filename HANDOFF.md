# HANDOFF

## Status

Continued productizing shuvcrawl beyond the Patchright+BPC spike. The app now has working CLI + REST support for `scrape`, `map`, `crawl`, `screenshot`, `pdf`, `config`, `version`, and `health`, plus shared CLI/API error classification and initial crawl state persistence.

## What was completed

### Prior work retained
- Patchright + BPC spike remains in place under `spikes/patchright-bpc/`
- Existing app skeleton under `src/` remains intact
- Existing CLI/API for `scrape`, `screenshot`, `pdf`, `config`, `health` still works
- Per-request runtime browser profiles and BPC seeding flow remain in place

### New work completed this round

#### Error handling / CLI behavior
- Added shared error classification layer in `src/errors/classify.ts`
- API error mapping now reuses shared classification in `src/api/errors.ts`
- CLI commands now use structured error handling via `src/cli/error-handler.ts`
- CLI exit codes now align with spec intent:
  - `2` config/auth
  - `3` network/timeout
  - `4` validation
  - `5` extraction
  - `6` robots denied
  - `7` rate limited
  - `8` browser init
- Added `version` command and version metadata in `package.json`

#### Map implementation
- Added page-link discovery utilities in `src/core/discovery.ts`
- Added `src/core/map.ts` to support URL discovery without content extraction
- Added CLI command:
  - `src/cli/commands/map.ts`
- Added API endpoint:
  - `POST /map`
- Added request schema support for `/map` in `src/api/schemas.ts`
- `map` behavior currently:
  - normalizes the seed URL
  - respects robots stub flow like scrape
  - tries fast-path first, then falls back to browser+BPC render
  - extracts anchor URLs from the rendered page
  - normalizes/deduplicates links
  - filters by same-origin by default
  - supports include/exclude glob filters

#### Crawl skeleton
- Added `src/core/crawl.ts`
- Added crawl state persistence in `src/storage/crawl-state.ts`
- Added CLI command:
  - `src/cli/commands/crawl.ts`
- Added API endpoint:
  - `POST /crawl`
- Added request schema support for `/crawl` in `src/api/schemas.ts`
- `crawl` behavior currently:
  - breadth-first sequential crawl
  - reuses `scrapeUrl()` for page extraction/output
  - reuses `mapUrl()` for link discovery
  - maintains visited/queue sets in memory
  - writes crawl state to `output/{domain}/_crawl-state.json`
  - returns job summary immediately after synchronous completion
- Current crawl scope is intentionally an initial skeleton, not a long-running job manager yet

#### Telemetry / logging improvements
- `createTelemetryContext()` now supports explicit `jobId` carryover for crawl flows
- Logger output now goes to stderr instead of stdout so JSON CLI output remains clean
- Crawl and map commands emit structured logs with request/job correlation

## Important files added or changed

### New files
- `src/errors/classify.ts`
- `src/cli/error-handler.ts`
- `src/cli/commands/version.ts`
- `src/cli/commands/map.ts`
- `src/cli/commands/crawl.ts`
- `src/core/discovery.ts`
- `src/core/map.ts`
- `src/core/crawl.ts`
- `src/storage/crawl-state.ts`
- `tests/unit/error-classify.test.ts`
- `tests/unit/auth-middleware.test.ts`
- `tests/unit/discovery.test.ts`
- `tests/unit/routes-map-crawl.test.ts`

### Updated files
- `package.json`
- `src/index.ts`
- `src/api/errors.ts`
- `src/api/routes.ts`
- `src/api/schemas.ts`
- `src/core/engine.ts`
- `src/core/scraper.ts`
- `src/utils/telemetry.ts`
- `src/utils/logger.ts`
- `src/cli/commands/scrape.ts`
- `src/cli/commands/screenshot.ts`
- `src/cli/commands/pdf.ts`
- `src/cli/commands/config.ts`
- `tests/unit/api-errors.test.ts`

## Current behavior

### CLI
Working commands now include:
- `bun run scrape -- https://example.com --json`
- `bun run map -- https://example.com --json`
- `bun run crawl -- https://example.com --depth 0 --limit 1 --json`
- `bun run screenshot -- https://example.com --json`
- `bun run pdf -- https://example.com --json`
- `bun run config -- --json`
- `bun run version -- --json`

Observed behavior:
- fast-path still degrades on local TLS issue: `unable to get local issuer certificate`
- browser fallback succeeds for scrape/map/crawl paths
- BPC extension still loads and seeds correctly
- CLI JSON output is now clean on stdout; structured logs go to stderr
- `map` currently returns discovered URLs and filter summary
- `crawl` currently completes synchronously and writes crawl state/output files

### API
Working endpoints now include:
- `GET /health`
- `GET /config`
- `POST /scrape`
- `POST /map`
- `POST /crawl`
- `POST /screenshot`
- `POST /pdf`

## Validation performed

### App / tests
- `bun run typecheck`
- `bun test`
- `bun run version -- --json`
- `bun run src/index.ts version`
- `bun run src/index.ts config --json`
- `bun run src/index.ts map https://example.com --json`
- `bun run src/index.ts crawl https://example.com --depth 0 --limit 1 --json`

### New test coverage
- expanded API error mapping
- shared error classification exit-code mapping
- auth middleware authorized/unauthorized paths
- discovery helper behavior
- `/map` and `/crawl` route envelopes

## Important findings

1. The shared error-classification layer works well for unifying CLI and API behavior.
2. Sending logs to stderr avoids contaminating JSON stdout output.
3. `map` is viable using the same fast-path/browser fallback pattern as scrape.
4. The current environment still has a local TLS/CA issue affecting fast-path fetches, but browser fallback continues to succeed.
5. The initial crawl skeleton works for sequential BFS crawling and state persistence, but it is synchronous and not yet a durable job system.
6. Current crawl state file path is `output/{domain}/_crawl-state.json`, matching spec direction.

## Known rough edges / limitations

- `robots.ts` is still a stub that always allows.
- `crawl` is synchronous, not a background job manager.
- No `GET /crawl/:jobId` or `DELETE /crawl/:jobId` yet.
- No sitemap discovery yet; `crawl.source` is accepted but effectively links-only for now.
- No resume implementation yet even though `resume` is accepted in the schema/options.
- No file-based cache read/write yet, only cache-key helper logic.
- `storage/output.ts` still lacks collision-safe slugging.
- `map` elapsed currently measures preflight + render/discovery only; it is fine for now but still basic.
- `crawl` writes results synchronously and may be slow for larger targets.
- The app still lacks `extract`, batch scrape endpoints, `update-bpc`, and richer crawl controls.

## Recommended next steps

### High priority
1. Add `GET /crawl/:jobId` and `DELETE /crawl/:jobId` with real job/status lookup semantics.
2. Decide whether V1 crawl should remain synchronous or move to an in-process background job registry.
3. Implement crawl resume using `_crawl-state.json`.
4. Add sitemap discovery support to `map`/`crawl` when `source` is `sitemap` or `both`.
5. Improve fast-path handling:
   - configurable TLS/CA behavior
   - acceptance heuristics beyond content length
6. Add integration tests for:
   - browser fallback path
   - map/crawl route shapes against real engine wiring
   - artifact capture and crawl-state writes
7. Expand telemetry toward Maple ingest / OTLP hooks per project instructions.

### Medium priority
- implement collision-safe output slugging
- add real cache persistence
- add selector override config by domain
- add richer metadata extraction / response header capture
- add `update-bpc`
- add API batch endpoints
- add `extract` scaffolding

## Useful commands

### Spike
- `cd spikes/patchright-bpc && bun run spike:patchright-bpc`
- `cd spikes/patchright-bpc && ./scripts/run-local.sh --scenario launch`
- `./spikes/patchright-bpc/scripts/run-docker.sh`
- `SPIKE_DOCKER_MODE=headed ./spikes/patchright-bpc/scripts/run-docker.sh`

### App
- `bun install`
- `bun run typecheck`
- `bun test`
- `bun run scrape -- https://example.com --json`
- `bun run map -- https://example.com --json`
- `bun run crawl -- https://example.com --depth 0 --limit 1 --json`
- `bun run screenshot -- https://example.com --json`
- `bun run pdf -- https://example.com --json`
- `bun run config -- --json`
- `bun run version -- --json`
- `bun run src/server.ts`

## Key output/report paths

- Spike local report:
  - `spikes/patchright-bpc/output/reports/patchright-bpc-spike-report.md`
- Spike docker reports:
  - `spikes/patchright-bpc/output/docker-headless/reports/patchright-bpc-spike-report.md`
  - `spikes/patchright-bpc/output/docker-headed/reports/patchright-bpc-spike-report.md`
- Productized app output:
  - `output/example.com/index.md`
  - `output/example.com/index.json`
  - `output/example.com/_meta.jsonl`
  - `output/example.com/_crawl-state.json`
  - `output/_artifacts/<requestId>/page.png`
  - `output/_artifacts/<requestId>/page.pdf`

## Git status note

At time of refresh, the repo still has many new/uncommitted files including the spike and the product code. HANDOFF.md has now been refreshed to reflect `map`, `crawl`, `version`, and shared error-handling work.
