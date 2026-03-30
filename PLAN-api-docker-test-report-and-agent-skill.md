# PLAN — Dockerized API Test Harness, Visual Report Package, and Shuvcrawl Agent Skill

## Objective

Design and implement a repeatable QA workflow that:

1. Spins up the **shuvcrawl API server in Docker**.
2. Runs a **broad automated API test suite** against the live containerized service.
3. Saves all results into a **reviewable artifact package**.
4. Produces a **high-quality visual report** using the existing `visual-explainer` skill conventions so results are easy to inspect.
5. Adds a **shippable agent skill** to the shuvcrawl app so AI agents can use shuvcrawl autonomously and safely.

This plan is intentionally implementation-oriented but does **not** make code changes.

---

## Why this work matters

Current project state already includes:

- Docker packaging for the API (`Dockerfile`, `docker-compose.yml`)
- a smoke test (`scripts/docker-smoke.sh`)
- **17 unit test files** covering auth middleware, route behavior, API errors, cache, config loading, crawl resume/state, discovery, error classification, fast-path TLS, job store, rate limiting, redaction, robots, telemetry, and URL helpers
- real-browser integration tests for engine/browser behavior (`tests/integration/browser.test.ts`)

What is missing is a **container-first, API-level validation harness** that exercises the deployed service as a black box and produces a **nice review artifact**, plus a **first-class packaged skill** so agents can discover and use shuvcrawl correctly.

---

## Scope

### In scope

- Docker-based API startup and teardown workflow
- Docker networking for fixture server reachability from container browser
- Black-box HTTP/API test coverage against the running container
- Local fixture server and static pages for deterministic test runs
- Artifact collection: logs, responses, metadata, screenshots, HTML summaries
- Visual results report in a format compatible with the `visual-explainer` workflow
- A packaged `skills/shuvcrawl/` skill shipped with the app using conventional `skills/` directory discovery
- Documentation updates for how to run the harness and use the shipped skill

### Out of scope

- Major scraper engine redesign
- Expanding the public API surface beyond what already exists
- Replacing existing unit/integration test suites
- Full CI pipeline implementation beyond what is needed to support the harness design
- Reworking telemetry architecture beyond what is necessary for test observability

---

## Relevant codebase references

### Product/runtime

- `README.md`
- `docker-compose.yml`
- `Dockerfile`
- `src/server.ts`
- `src/api/routes.ts`
- `src/api/middleware.ts`
- `src/api/schemas.ts`
- `src/api/errors.ts` — error envelope builder, delegates to `src/errors/classify.ts`
- `src/errors/classify.ts` — error classification with `ErrorCode` type (`INVALID_REQUEST`, `NETWORK_ERROR`, `TIMEOUT`, `BROWSER_INIT_FAILED`, etc.) and HTTP status mapping
- `src/config/schema.ts` — full config Zod schemas (browser, BPC, fast-path, TLS, cache, crawl, API, telemetry)
- `src/config/loader.ts` — config loading from env vars
- `src/config/redact.ts` — secret redaction for `/config` endpoint responses
- `src/config/defaults.ts` — default config values
- `src/core/engine.ts`
- `src/storage/job-store.ts`
- `src/utils/telemetry.ts`

### Current tests (17 unit + 1 integration suite)

- `tests/unit/auth-middleware.test.ts` — auth middleware behavior
- `tests/unit/routes-map-crawl.test.ts` — route-level map/crawl logic
- `tests/unit/api-errors.test.ts` — error envelope/classification
- `tests/unit/cache.test.ts` — cache read/write/bypass
- `tests/unit/config-loader.test.ts` — config loading
- `tests/unit/crawl-resume.test.ts` — crawl resume logic
- `tests/unit/crawl-state.test.ts` — crawl state transitions
- `tests/unit/discovery.test.ts` — link/sitemap discovery
- `tests/unit/error-classify.test.ts` — error code classification
- `tests/unit/fast-path-tls.test.ts` — fast-path TLS behavior
- `tests/unit/job-store.test.ts` — SQLite job persistence
- `tests/unit/rate-limit.test.ts` — rate limiter
- `tests/unit/redact.test.ts` — config redaction
- `tests/unit/robots.test.ts` — robots.txt parsing
- `tests/unit/bpc.test.ts` — Bypass Paywalls Clean
- `tests/unit/telemetry.test.ts` — telemetry setup
- `tests/unit/url.test.ts` — URL helpers
- `tests/integration/browser.test.ts` — real browser launch
- `tests/integration/setup.ts` — integration test setup
- `scripts/docker-smoke.sh` — minimal Docker health + scrape check

### Relationship between unit tests and new API suite

Many behaviors already have unit coverage (cache, error classification, redaction, job persistence, rate limiting). The new black-box API suite should **complement** this by testing these behaviors through the HTTP interface at the integration boundary. Unit tests stay as-is; API tests verify the same contracts hold when running through Docker. Avoid duplicating assertions that are already well-covered at the unit level — focus API tests on the HTTP envelope, end-to-end data flow, and Docker-specific runtime behavior.

### Packaging / skill references

- Pi skills docs: `/home/shuv/.local/share/mise/installs/node/25.2.1/lib/node_modules/@mariozechner/pi-coding-agent/docs/skills.md`
- Pi packages docs: `/home/shuv/.local/share/mise/installs/node/25.2.1/lib/node_modules/@mariozechner/pi-coding-agent/docs/packages.md`
- Existing visual explainer skill: `/home/shuv/repos/shuvbot-skills/visual-explainer/SKILL.md`
- Example browser automation skill: `/home/shuv/repos/agent-browser/skills/agent-browser/SKILL.md`

---

## High-level deliverables

### Deliverable A — Docker API test harness
A scripted workflow that starts the Dockerized API, waits for health, runs live API tests, captures outputs, and tears everything down cleanly.

### Deliverable B — Broad API suite
A dedicated test suite focused on black-box API behavior rather than direct engine internals.

### Deliverable C — Result package
A structured output directory containing machine-readable and human-readable results.

### Deliverable D — Visual explainer report
A self-contained HTML review page that summarizes pass/fail status, coverage, timings, artifacts, and notable failures.

### Deliverable E — Shippable shuvcrawl skill
A packaged agent skill under the app repo that teaches AI agents when and how to use shuvcrawl safely and autonomously.

---

## Proposed architecture

```text
scripts/test-api-docker.sh (shell wrapper)
  -> create runId + test-results/{runId}/
  -> generate run-scoped config.json under test-results/{runId}/runtime/
  -> docker compose -p shuvcrawl-api-test-${runId} -f docker-compose.yml -f docker-compose.test.yml up -d --build
       -> shuvcrawl service gets SHUVCRAWL_CONFIG=/app/test-runtime/config.json
       -> test overlay disables restart policy and mounts run-scoped runtime dirs
  -> wait for shuvcrawl /health on localhost:3777
  -> wait for fixture server /health on localhost:4444
  -> bun run scripts/run-api-suite.ts
       -> run bun:test tests/api/ against localhost:3777
       -> API tells shuvcrawl to scrape http://fixtures:4444/... (container-to-container)
       -> tests emit structured JSONL records for aggregation
       -> runner writes summary.json, suite.json, manifest.json, report.html
  -> capture docker compose ps/logs/inspect
  -> docker compose -p shuvcrawl-api-test-${runId} down -v (always, via trap)
```

### Design principles

- **Black-box first**: test the deployed HTTP interface, not just imported functions.
- **Deterministic where possible**: prefer local/static fixtures and `data:` URLs over flaky public sites.
- **Artifact-rich**: failures should include enough evidence to debug without rerunning immediately.
- **Review-friendly**: produce a polished report, not just terminal output.
- **Agent-usable**: the shipped skill should encode workflows, guardrails, and examples so autonomous agents can use shuvcrawl well.
- **Telemetry-aware**: test harness should capture timings and, where practical, verify telemetry behavior.

---

## Workstream 1 — Dockerized API startup harness

### Goals

- Create a single entrypoint to run the full containerized API validation flow.
- Make startup/teardown reliable and safe.
- Capture Docker logs and environment context for debugging.

### Proposed changes

- Add a **thin shell wrapper** `scripts/test-api-docker.sh` that owns Docker lifecycle:
  - creates a unique `runId`
  - creates `test-results/{runId}/` and run-scoped runtime directories
  - generates a run-specific config file mounted into the container via `SHUVCRAWL_CONFIG`
  - builds the image (with optional `--no-build` flag)
  - starts the shuvcrawl service and fixture server via compose using a unique project name
  - waits for `/health` on both shuvcrawl and fixtures
  - invokes `bun run scripts/run-api-suite.ts` for test execution
  - captures `docker compose ps`, `docker compose logs`, and optional `inspect`
  - runs `docker compose down -v` in a `trap` block for guaranteed cleanup on exit/signal
- Add the **Bun/TypeScript test runner** `scripts/run-api-suite.ts` that handles:
  - invoking the `bun:test` API suite
  - aggregating structured test records into JSON
  - artifact collection
  - HTML report generation
- Keep `scripts/docker-smoke.sh` as the smallest sanity check (health + single scrape).

### Recommended approach — shell + Bun split

Docker lifecycle management (compose up/down, log capture, cleanup-on-signal) is more robust in shell with `trap`. Test execution, result aggregation, and report generation benefit from TypeScript. Split accordingly:

- **`scripts/test-api-docker.sh`** — Docker lifecycle, trap cleanup, environment setup
- **`scripts/run-api-suite.ts`** — test execution, result JSON, HTML report

This ensures cleanup always runs even on SIGINT/SIGTERM, which is harder to guarantee from a Bun process managing Docker.

### Tasks

- [x] Create `scripts/test-api-docker.sh` shell wrapper with Docker lifecycle and `trap` cleanup.
- [x] Create `scripts/run-api-suite.ts` Bun entrypoint for test execution and reporting.
- [x] Generate a unique `runId` per execution and use it for:
  - result folder naming
  - Docker Compose project naming
  - test record correlation
- [x] Generate a run-scoped config file under `test-results/{runId}/runtime/config.json` so the container writes all mutable state into run-local paths.
- [x] Override Docker test runtime state so each run is isolated:
  - output/artifacts
  - cache
  - browser profile dirs
  - SQLite job DB
  - any temp runtime folders needed for fixtures/results
- [x] Override `restart: unless-stopped` to `restart: "no"` in the test compose overlay.
- [x] Support `--no-build` flag in the shell wrapper to skip image rebuild.
- [x] Implement robust health polling against `GET /health` in the shell wrapper.
- [x] Capture startup metadata:
  - Docker image hash/tag if available
  - container IDs
  - Compose project name
  - start timestamp
  - relevant env knobs/config path used for the run
- [x] Capture teardown metadata and always run cleanup via `trap`.
- [x] Store Docker stdout/stderr logs inside the results package.
- [x] Add `test:api` script to `package.json` pointing to the shell wrapper.

### Validation criteria

- [ ] Harness exits non-zero on startup failure or test failure.
- [ ] Harness always tears down containers even on SIGINT/SIGTERM/failed runs.
- [ ] Logs and metadata are preserved on failure.
- [ ] No cache/job/output/artifact state leaks between consecutive runs.

---

## Workstream 2 — Broad live API test suite

### Test framework

Use **`bun:test`** for the API suite, consistent with all existing tests. This provides:
- built-in assertion library
- parallel test execution
- familiar runner for contributors

However, Bun does **not** provide a native JSON reporter in the current toolchain used by this repo. The harness must therefore generate `suite.json` by one of these explicit mechanisms:

1. **Preferred:** API tests write structured JSONL event records to a run-scoped file (test start, request, response, assertion metadata, failure evidence), and `scripts/run-api-suite.ts` aggregates those records into `suite.json`.
2. **Fallback:** run Bun with `--reporter=junit` and transform JUnit XML into the run schema, supplementing with per-test JSONL sidecar files for request/response details.

The recommended implementation is **JSONL sidecar events + Bun test execution**, because the report needs richer per-request/per-artifact detail than JUnit alone can provide.

Test files should live under `tests/api/` to distinguish from existing `tests/unit/` and `tests/integration/` suites.

## Test categories

The new suite should cover the current documented API in `README.md` and `src/api/routes.ts`. Tests should assert against the error codes defined in `src/errors/classify.ts` (`INVALID_REQUEST`, `NETWORK_ERROR`, `TIMEOUT`, `BROWSER_INIT_FAILED`, `UNAUTHORIZED`, etc.) and the envelope shape from `src/api/errors.ts`.

### A. Service lifecycle and configuration

Endpoints:
- `GET /health`
- `GET /config`

Coverage:
- [ ] health endpoint responds 200 and includes service/config summary fields
- [ ] config endpoint redacts secrets when token is configured
- [ ] startup config is reflected correctly in runtime responses
- [ ] health remains stable before and after workload execution

### B. Authentication

Current auth behavior lives in `src/api/middleware.ts` and existing unit tests.

Coverage:
- [ ] unauthenticated requests fail when `SHUVCRAWL_API_TOKEN` is set
- [ ] invalid bearer token returns 401
- [ ] valid bearer token allows access
- [ ] public behavior when token is unset remains documented and tested

### C. Input validation and error envelope behavior

Schemas live in `src/api/schemas.ts`.

Coverage:
- [ ] invalid URL payloads are rejected for every POST endpoint
- [ ] malformed JSON is normalized to the same structured `INVALID_REQUEST` envelope as other client payload errors
- [ ] schema violations preserve expected status codes / envelope shape
- [ ] 404 behavior for unknown crawl job IDs
- [ ] cancellation behavior for missing/non-running jobs

### D. Core API operations

Endpoints:
- `POST /scrape`
- `POST /map`
- `POST /crawl`
- `GET /crawl/:jobId`
- `DELETE /crawl/:jobId`
- `POST /screenshot`
- `POST /pdf`

Coverage:
- [ ] scrape basic success case
- [ ] scrape with options (`rawHtml`, `onlyMainContent`, `headers`, wait strategy)
- [ ] map basic success case
- [ ] crawl async submission returns job envelope
- [ ] crawl polling transitions eventually resolve to terminal state (poll every 1s, max 60s timeout, fixture site should be ≤5 pages to keep this fast)
- [ ] crawl cancel path works for a running job
- [ ] screenshot success returns valid file path and creates a real image artifact
- [ ] pdf success returns valid file path and creates a real PDF artifact

### E. Wait strategies and browser-backed behavior

Coverage:
- [ ] `wait: load`
- [ ] `wait: networkidle`
- [ ] `wait: selector` with `waitFor`
- [ ] `wait: sleep`
- [ ] timeout behavior when selectors never appear

### F. Artifact and output behavior

Coverage:
- [ ] scrape writes output files when expected
- [ ] screenshot/pdf artifacts land in expected directories
- [ ] console log artifact behavior is captured where enabled
- [ ] crawl state / job persistence is observed for async jobs

### G. Cache / repeatability behavior

Coverage:
- [ ] repeated scrape requests behave correctly with cache enabled within a single isolated run
- [ ] `noCache` path bypasses cache
- [ ] cache-related fields/artifacts are reflected consistently if exposed
- [ ] cache state does not leak across separate harness runs

### H. Telemetry / observability behavior

Current telemetry code is in `src/utils/telemetry.ts` and is OTLP HTTP based.

Coverage:
- [ ] run-level timing is captured by the test harness
- [ ] API request-level elapsed fields are preserved in responses where documented
- [ ] structured test records include stable correlation IDs (`runId`, `testId`, `requestId`, `jobId` where applicable)
- [ ] if OTLP endpoint is configured for the suite, exporter attempts can be verified against a fake/local collector behind a feature flag
- [ ] failures capture enough metadata to correlate request/job/test case

### I. Negative and resilience cases

Coverage:
- [ ] unreachable URL / network failure surfaces cleanly
- [ ] auth failure cases preserve a stable envelope
- [ ] invalid job lifecycle transitions return correct errors
- [ ] browser-backed endpoints fail with useful evidence when browser init/navigation fails

---

## Workstream 3 — Test fixtures and determinism strategy

### Problem

If the suite targets arbitrary internet pages, it will be noisy and flaky.

### Recommended solution

Introduce a **local fixture server** for the API suite so most tests are deterministic.

### Docker networking for fixture reachability

The shuvcrawl container runs Chromium which must navigate to fixture URLs. The fixture server runs on the host (or as a sibling container). The browser inside Docker needs a network path to reach it.

**Recommended approach:** Run the fixture server as a **second Docker Compose service**.

This is the most reliable option and works identically in CI and local dev:

```yaml
# docker-compose.test.yml (extends docker-compose.yml)
services:
  fixtures:
    build:
      context: .
      dockerfile: tests/fixtures/Dockerfile  # lightweight Bun image serving static files
    ports:
      - "4444:4444"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4444/health"]
      interval: 5s
      timeout: 3s
      retries: 20
    networks:
      - default

  shuvcrawl:
    # inherits from base compose
    depends_on:
      - fixtures
    restart: "no"
    networks:
      - default
```

With both services on the same Docker network, shuvcrawl's browser reaches fixtures at `http://fixtures:4444/...`. The test runner on the host reaches shuvcrawl at `http://localhost:3777` and tells it to scrape `http://fixtures:4444/page.html`. The fixture service should expose a dedicated `GET /health` endpoint so the shell harness can wait on an explicit readiness signal rather than probing arbitrary content pages.

**Alternative approaches (not recommended for primary use):**
- `host.docker.internal` — works on Docker Desktop, unreliable on Linux Docker Engine without `--add-host`
- `--network=host` — loses container isolation, breaks port mapping assumptions

The shell wrapper (`scripts/test-api-docker.sh`) should use `docker compose -f docker-compose.yml -f docker-compose.test.yml` to layer in the fixture service.

### Fixture server implementation

A minimal Bun HTTP server serving static fixture pages:

- `tests/fixtures/Dockerfile` — lightweight `oven/bun:1.2` image that runs the server
- `tests/fixtures/server.ts` — Bun.serve that serves `tests/fixtures/site/` as static files plus dynamic routes
- `tests/fixtures/site/` — static HTML pages:
  - `article.html` — simple HTML article for scrape
  - `delayed.html` — content appears after JS timeout (for selector wait tests)
  - `links.html` — link graph for `/map`
  - `site/` — crawlable multi-page mini-site (≤5 pages for fast crawl tests)
  - `console.html` — page with console.log output
  - `visual.html` — screenshot-friendly styled page
  - `printable.html` — PDF-friendly page
- Dynamic routes in `server.ts`:
  - `/health` — explicit readiness endpoint returning 200
  - `/timeout` — never responds (for timeout tests)
  - `/error-500` — returns HTTP 500
  - `/slow/:ms` — responds after configurable delay

### `data:` URL usage (limited scope)

Use `data:` URLs **only** for trivial single-page scrape tests where no link navigation, asset loading, or cross-page behavior is needed. `data:` URLs cannot contain navigable relative links, so they are unsuitable for map, crawl, or any multi-page test.

### Avoid

Using third-party sites for core pass/fail assertions. External sites may be used only for explicitly tagged smoke cases.

### Tasks

- [x] Create `docker-compose.test.yml` with fixture server service.
- [x] Create `tests/fixtures/Dockerfile` (minimal Bun image).
- [x] Create `tests/fixtures/server.ts` with static serving and dynamic routes.
- [x] Add `GET /health` to the fixture server and use it for readiness checks.
- [x] Build fixture pages covering all major API behaviors in `tests/fixtures/site/`.
- [ ] Verify fixture server is reachable from shuvcrawl container at `http://fixtures:4444/`.
- [ ] Ensure fixture URLs are stable and do not require external internet.
- [ ] Keep a very small number of external smoke cases only if strategically valuable, tagged `@external`.

### Validation criteria

- [ ] Fixture server starts and is reachable from inside the shuvcrawl container.
- [ ] Majority of suite passes offline except for explicitly `@external` tests.
- [ ] Failures are reproducible locally.

---

## Workstream 4 — Results package design

### Goal

Produce a single run folder that contains everything needed for review and debugging.

### Output directory

Use a dedicated `test-results/` root directory (separate from `output/` which holds scrape artifacts and is Docker-mounted). Add `test-results/` to `.gitignore`.

### Proposed output layout

```text
test-results/{run-id}/
├── summary.json                 # overall run summary
├── suite.json                   # per-test structured results
├── manifest.json                # package inventory + metadata
├── env.json                     # selected config/env info (redacted)
├── runtime/
│   ├── config.json              # generated run-scoped config passed to container
│   ├── output/                  # scrape output written by the test run only
│   ├── artifacts/               # request-scoped capture artifacts written by the run only
│   ├── cache/                   # run-local cache
│   ├── browser/                 # run-local browser profiles
│   └── jobs.db                  # run-local SQLite job store
├── docker/
│   ├── compose-ps.txt
│   ├── compose-logs.txt
│   └── inspect.json             # optional
├── api/
│   ├── events.jsonl             # structured per-test/per-request event ledger
│   ├── requests.jsonl           # request/response timing ledger
│   ├── failures/                # failing response bodies, stack traces
│   └── jobs/                    # crawl polling snapshots
├── artifacts/
│   ├── screenshots/
│   ├── pdf/
│   └── scraped-output/
└── report.html                  # polished visual review page
```

### Result schema recommendations

For each test case record:

- `id`
- `runId`
- `category`
- `name`
- `status` (`passed` | `failed` | `skipped`)
- `startedAt`
- `elapsedMs`
- `request` summary
- `response` summary
- `requestId`
- `jobId`
- `artifacts`
- `notes`
- `error` details if failed

For event-sidecar records in `api/events.jsonl`:

- `runId`
- `testId`
- `eventType` (`test.start`, `request.sent`, `response.received`, `artifact.recorded`, `test.pass`, `test.fail`)
- `ts`
- `endpoint`
- `method`
- `url`
- `requestId`
- `jobId`
- `elapsedMs`
- `statusCode`
- `artifactPath`
- `details`

### Tasks

- [x] Define stable JSON schema for summary and per-test records.
- [x] Define the event JSONL schema used by tests and the aggregator.
- [x] Add manifest listing all generated files.
- [x] Redact any tokens or secrets before saving env/config snapshots (use `src/config/redact.ts` conventions).
- [x] Make the run-local runtime directory the source of truth for test outputs, then mirror/link selected evidence into the top-level artifact sections for reviewer convenience.
- [x] Add `test-results/` to `.gitignore`.

Archive packaging (tar.gz/zip) is deferred to a later iteration. The folder layout is self-contained and sufficient for local review and sharing.

### Validation criteria

- [ ] A failed run is debuggable from the artifact folder alone.
- [ ] Package is navigable by both humans and other automation.
- [ ] All mutable state created by the run is contained within the run folder or clearly derived from it.

---

## Workstream 5 — Visual explainer results report

### Goal

Render the test run into a polished visual report instead of a raw terminal dump.

### Recommended approach

Generate a **self-contained HTML report** using the `visual-explainer` skill’s Blueprint-style workflow and conventions:

- summary hero with run status and key metrics
- coverage table by endpoint/category
- pass/fail timeline or step list
- failure cards with links to raw evidence
- artifact inventory
- environment/runtime context

### Suggested report sections

1. **Hero / executive summary**
   - run status
   - total tests
   - pass/fail counts
   - total runtime
   - Docker image / container info

2. **Coverage overview**
   - endpoint matrix
   - category breakdown
   - auth/config/validation/core/crawl/artifacts/telemetry coverage

3. **Detailed results**
   - one card or row per test case
   - timings
   - request target
   - notable assertions
   - artifact links

4. **Failures and warnings**
   - grouped by severity or category
   - raw response/log excerpts

5. **Artifacts and evidence**
   - screenshots, PDFs, output files, Docker logs

6. **Operational notes**
   - what was configured
   - whether external network was used
   - telemetry verification mode

### Rendering strategy

Use a **repo-local HTML generator** (`scripts/run-api-suite.ts` or a dedicated `scripts/report-generator.ts`) that builds report HTML directly from the test result JSON.

This is deterministic, has no runtime dependency on external skill loading, and runs in CI. The report should borrow the `visual-explainer` design language (dark theme, grouped cards, summary hero) but be fully self-contained in the repo.

An external visual-explainer integration was considered but rejected because it would couple the test harness to a skill path outside the repo, complicating CI and portability.

### Tasks

- [x] Define report input JSON contract (reads `suite.json` + `summary.json` from the run folder).
- [x] Create a self-contained HTML template with embedded CSS (visual-explainer dark theme style).
- [x] Include grouped cards/tables by test category with pass/fail/skip counts.
- [x] Link every failing test to raw artifacts/logs using relative paths within the run folder.
- [x] Save `report.html` at the run folder root and optionally open it via `xdg-open`.

### Validation criteria

- [ ] Reviewer can understand run health without reading raw logs.
- [ ] Reviewer can drill from summary to exact evidence for any failed case.
- [ ] Report remains readable for larger suites (categories collapsible or anchor-linked).
- [ ] Report can be generated from the aggregator contract without depending on a Bun JSON reporter that does not exist.

---

## Workstream 6 — Packaged shuvcrawl agent skill

### Goal

Ship a first-class skill with shuvcrawl so agents can discover and use it autonomously.

### Packaging constraints from Pi docs

Per Pi docs, the conventional `skills/` directory discovery works automatically for packages:

- create a `skills/` directory in the repo
- add a skill directory `skills/shuvcrawl/`
- place `SKILL.md` inside it

Pi discovers `skills/` directories in packages automatically, so a `pi.skills` entry in `package.json` is **not required for discovery**. However, project-local guidance currently says packaged AI skills should be under `skills/` **and wired via `package.json`**. To avoid future confusion, this workstream should resolve that discrepancy explicitly:

- **Discovery source of truth:** conventional `skills/` directory layout
- **Optional package metadata:** add Pi package metadata only if needed for package gallery/distribution clarity, not for runtime skill discovery
- **Follow-up doc task:** update local `AGENTS.md` wording to match the chosen packaging approach so repo guidance and Pi docs are consistent

### Proposed skill path

- `skills/shuvcrawl/SKILL.md`

Optional supporting assets:
- `skills/shuvcrawl/references/api.md`
- `skills/shuvcrawl/references/examples.md`
- `skills/shuvcrawl/templates/*.json`
- `skills/shuvcrawl/scripts/*.sh` or `*.ts` only if truly useful

### Skill responsibilities

The skill should teach agents:

- when to use shuvcrawl
- which command/API path to prefer for each task
- how to choose between `scrape`, `map`, `crawl`, `screenshot`, and `pdf`
- how to structure requests/options
- how to interpret outputs/artifacts
- how to work safely with auth, robots, cache, and proxies
- how to validate success and recover from common failures

### Recommended skill content outline

#### 1. Frontmatter

- `name: shuvcrawl`
- clear trigger-rich description mentioning scraping, mapping, crawling, screenshots, PDFs, local API usage, and agent autonomy

#### 2. Purpose and when to use

Examples:
- scrape an article into markdown/json
- map links on a page
- crawl a site with depth/limit constraints
- capture screenshot or PDF
- use local Docker or local Bun server

#### 3. Preferred operating modes

- CLI mode for local quick tasks
- API mode for orchestration and structured automation
- Docker mode when the service is not already running

#### 4. Safe workflow

- check whether service is already running
- if not, start it via Docker or local serve command
- confirm `/health`
- perform the operation
- save artifacts/results
- shut down only if the agent started the service and the task is complete

#### 5. Endpoint and command reference

Map CLI commands to API endpoints and typical payloads.

#### 6. Decision guide

Examples:
- use `scrape` for one page’s extracted content
- use `map` for URL discovery
- use `crawl` for multi-page async exploration
- use `screenshot` for visual evidence
- use `pdf` for printable/exportable capture

#### 7. Common options and heuristics

- wait strategies
- selector usage
- raw HTML
- only-main-content
- include/exclude patterns
- crawl delay/depth/limit
- auth token usage
- no-cache / no-robots caveats

#### 8. Output interpretation

- where files are written
- how job IDs work
- how to poll crawl jobs
- how to find artifacts

#### 9. Failure handling

- auth failures
- invalid URL/schema failures
- browser launch/navigation timeouts
- crawl cancellation
- flaky selector waits

#### 10. Examples for agents

Concrete CLI and HTTP examples with expected outputs.

### Skill quality bar

The skill should be more than a command list. It should encode judgment and guardrails so agents can operate autonomously without abusing the tool.

### Tasks

- [x] Create `skills/shuvcrawl/SKILL.md`.
- [x] Add any needed `references/` docs for deeper guidance.
- [x] Verify Pi discovers the skill via conventional `skills/` directory.
- [x] Decide whether `package.json` should include optional Pi package metadata for shipping clarity, while keeping `skills/` as the discovery mechanism.
- [x] Include examples for both CLI and API usage.
- [x] Include explicit safety guidance around long-running crawls, auth tokens, and robots behavior.
- [x] Cross-check skill examples against `src/api/routes.ts`, `src/api/schemas.ts`, and `src/index.ts` to ensure accuracy.
- [x] Reconcile or update `AGENTS.md` guidance so it does not conflict with the final packaging choice.

### Validation criteria

- [ ] Skill is discovered by Pi when running from the repo root.
- [ ] Another agent can read the skill and complete common shuvcrawl tasks without additional handholding.
- [ ] Skill content matches the actual API/CLI behavior in source and corrected docs.
- [ ] Repo guidance (`AGENTS.md`) and packaging/discovery behavior no longer conflict.

---

## Workstream 7 — Documentation and developer experience

### Changes to plan for

- `README.md`
  - add section for running Docker API validation suite
  - add section for finding the generated report in `test-results/`
  - add section for bundled AI skill / Pi discovery

- `package.json`
  - add `test:api` script pointing to `scripts/test-api-docker.sh`

- Optional new docs:
  - `docs/testing.md`
  - `docs/skill.md`

### Tasks

- [x] Document how to run the Docker API suite locally (`bun run test:api` or `./scripts/test-api-docker.sh`).
- [x] Document `test-results/` output and report locations.
- [x] Document that each run uses isolated runtime state and where that state lives.
- [x] Document shipped skill discovery (run Pi from repo root; skill is auto-discovered via `skills/shuvcrawl/`).
- [x] Correct any README/API examples that do not match source behavior (for example `wait` vs `waitStrategy`).
- [x] Document any prerequisites for browser-backed API tests (Docker, compose).

---

## Workstream 8 — Telemetry and observability requirements

Per project guidance, telemetry is mandatory and should be considered part of definition-of-done.

### Requirements for this effort

- The test harness must emit structured run/test lifecycle logs.
- Every test case must have stable identifiers.
- Timings must be captured per test and for the total run.
- Failures must include explicit error classification.
- Baseline telemetry validation for v1 is **required**:
  - structured harness logs
  - stable `runId` / `testId`
  - persisted timing data in result JSON
- OTLP exporter verification against a fake/local collector may be staged behind a feature flag, but the baseline telemetry contract above is not optional.

### Proposed telemetry fields for test records

- `runId`
- `testId`
- `category`
- `endpoint`
- `requestId` if returned by API
- `jobId` when applicable
- `elapsedMs`
- `status`
- `errorClass`
- `artifactPaths`

### Tasks

- [x] Define structured logging for the harness.
- [x] Persist timing metrics in result JSON.
- [x] Add stable `runId` / `testId` / `requestId` / `jobId` correlation where available.
- [x] Add a feature-flagged fake OTLP receiver path for exporter verification.
- [x] Surface baseline telemetry fields and OTLP verification status in the visual report.

---

## Proposed implementation sequence

### Phase 1 — Foundation

- [ ] Create/confirm project-local guidance (`AGENTS.md`) and align docs.
- [ ] Design result schemas and run directory layout.
- [ ] Confirm shell wrapper + Bun runner split as the harness architecture.
- [ ] Define the broad API test matrix and fixture strategy.

### Phase 2 — Harness + fixtures

- [ ] Build fixture site, server, and `tests/fixtures/Dockerfile`.
- [ ] Create `docker-compose.test.yml` with fixture service.
- [ ] Implement shell wrapper (`scripts/test-api-docker.sh`) with Docker lifecycle and `trap` cleanup.
- [ ] Implement Bun runner (`scripts/run-api-suite.ts`) with result collection primitives.
- [ ] Verify fixture server is reachable from shuvcrawl container.

### Phase 3 — Live API test coverage

- [ ] Add service/config/auth/validation tests.
- [ ] Add scrape/map/crawl tests.
- [ ] Add screenshot/pdf/artifact tests.
- [ ] Add resilience and negative-path cases.

### Phase 4 — Reporting package

- [ ] Write summary/manifests to `test-results/{run-id}/`.
- [ ] Save Docker logs and evidence files.
- [ ] Generate self-contained HTML report.

### Phase 5 — Agent skill packaging

- [ ] Create `skills/shuvcrawl/SKILL.md` and references.
- [ ] Verify Pi discovers the skill via conventional `skills/` directory.
- [ ] Document usage in `README.md`.

### Phase 6 — Final validation

- [ ] Run the suite end-to-end against Docker.
- [ ] Open the generated report and verify readability.
- [ ] Confirm Pi discovers the bundled skill.
- [ ] Confirm docs and examples match behavior.

---

## Suggested new/updated files

### New files

- [ ] `PLAN-api-docker-test-report-and-agent-skill.md` (this plan)
- [ ] `skills/shuvcrawl/SKILL.md`
- [ ] `skills/shuvcrawl/references/api.md`
- [ ] `skills/shuvcrawl/references/examples.md`
- [ ] `scripts/test-api-docker.sh` — shell wrapper for Docker lifecycle
- [ ] `scripts/run-api-suite.ts` — Bun test runner + report generator
- [ ] `scripts/lib/api-test-recorder.ts` or equivalent helper — structured JSONL event recorder for tests
- [ ] `docker-compose.test.yml` — compose overlay with fixture server and isolated test runtime overrides
- [ ] `tests/api/*.test.ts` — black-box API test files
- [ ] `tests/fixtures/Dockerfile` — lightweight fixture server image
- [ ] `tests/fixtures/server.ts` — fixture HTTP server
- [ ] `tests/fixtures/site/*` — static fixture HTML pages

### Existing files likely to update

- [ ] `package.json` — add `test:api` script
- [ ] `README.md` — add testing, report, and skill sections; fix any drifted API examples
- [ ] `.gitignore` — add `test-results/`
- [ ] `AGENTS.md`
- [ ] `src/api/routes.ts` and/or `src/errors/classify.ts` — if needed, normalize malformed JSON into a stable client error envelope before locking tests to that contract

---

## Recommended test matrix (first full pass)

| Category | Example cases | Notes |
|---|---|---|
| Health/config | `/health`, `/config`, redaction | quick smoke + runtime sanity |
| Auth | missing token, wrong token, correct token | container env driven |
| Validation | bad URL, malformed JSON, missing job | stable error contract |
| Scrape | basic page, selector wait, rawHtml, onlyMainContent | mostly fixture-based |
| Map | links-only, sitemap-only, both | fixture mini-site |
| Crawl | async submit, poll, cancel, completion | local multi-page fixture |
| Capture | screenshot + pdf | verify files and metadata |
| Artifacts | output dirs, console logs, job persistence | filesystem assertions |
| Resilience | timeout/error page/unreachable target | deterministic negative cases |
| Telemetry | elapsed fields, optional OTLP collector | optional but valuable |

---

## Risks and mitigations

### Risk 1 — Browser-backed tests are flaky in Docker

**Mitigation**
- prefer local fixtures
- isolate browser-heavy tests from simpler API contract tests
- capture full Docker logs and artifacts on failure
- keep timeouts explicit

### Risk 2 — Result report becomes too thin or too noisy

**Mitigation**
- define report schema before implementation
- summarize at category level first, drill down second
- link out to raw artifacts instead of inlining everything

### Risk 3 — Skill drifts from actual implementation

**Mitigation**
- base skill examples directly on `README.md`, `src/api/routes.ts`, `src/index.ts`
- add validation pass comparing skill instructions against real commands/endpoints

### Risk 4 — Packaging/discovery confusion for the skill

**Mitigation**
- rely on Pi's conventional `skills/` directory discovery as the runtime discovery mechanism
- keep skill at `skills/shuvcrawl/SKILL.md`
- decide separately whether optional `package.json` Pi metadata is helpful for shipping clarity
- update `AGENTS.md` and `README.md` so local guidance matches the chosen approach
- verify discovery works during Phase 6 validation

### Risk 5 — Fixture server unreachable from container browser

**Mitigation**
- run fixture server as a sibling Docker Compose service on the same network
- use `docker-compose.test.yml` overlay to wire the `fixtures` service
- verify reachability early in Phase 2 before writing tests against it
- fall back to `host.docker.internal` with `--add-host` only if compose networking fails

### Risk 6 — Telemetry validation is skipped

**Mitigation**
- treat run/test timings, structured logs, and stable IDs as required
- stage fake-collector OTLP verification behind a flag only for the exporter-specific piece
- do not allow the feature to ship without the baseline telemetry contract

---

## Acceptance criteria

### Functional

- [ ] A single command can run the containerized API validation workflow.
- [ ] The workflow exercises a broad black-box API suite against Docker.
- [ ] The workflow produces a structured result package in `test-results/` for each run.
- [ ] A polished HTML report is generated and is useful for review.
- [ ] Fixture server is reachable from the shuvcrawl container browser.
- [ ] Each test run is isolated from prior runs at the Docker, cache, output, artifact, and job-store levels.
- [ ] A bundled `shuvcrawl` agent skill ships with the app and is discoverable by Pi via conventional `skills/` directory.

### Quality

- [ ] Test evidence is sufficient to debug failures without rerunning immediately.
- [ ] The suite is mostly deterministic and does not depend heavily on public internet pages.
- [ ] The report clearly distinguishes passes, failures, warnings, timings, and artifacts.
- [ ] The skill includes operational guidance, not just command syntax.

### Documentation

- [ ] README explains how to run the suite, find the report, and use the bundled skill.
- [ ] README/API examples match the real CLI/API behavior.
- [ ] Skill docs match real CLI/API behavior.
- [ ] `AGENTS.md` does not contradict the chosen skill-packaging approach.

### Observability

- [ ] Run-level and test-level structured logs exist.
- [ ] Timings and IDs are persisted in the result package.
- [ ] Baseline telemetry contract is implemented, not deferred.
- [ ] Feature-flagged OTLP verification path is designed and documented.

---

## Recommended implementation order for execution

1. **Create result schema + `test-results/` folder layout + JSONL event contract**
2. **Build fixture server** (`tests/fixtures/`) and `docker-compose.test.yml`
3. **Implement run isolation strategy** (run-scoped config, output, cache, browser profile, job DB, Compose project name)
4. **Build shell wrapper** (`scripts/test-api-docker.sh`) with Docker lifecycle and fixture reachability check
5. **Build Bun runner** (`scripts/run-api-suite.ts`) with result aggregation from event records
6. **Normalize malformed JSON API behavior if needed** so tests can lock to a stable contract
7. **Add `bun:test` API test suite** under `tests/api/`
8. **Add artifact packaging** (Docker logs, failure evidence, screenshots/PDFs)
9. **Generate HTML report**
10. **Create `skills/shuvcrawl/` skill**
11. **Update docs/guidance and validate end-to-end**

This order minimizes rework: once the run schema and fixture server exist, the harness, tests, report generator, and skill examples can all align around the same runtime behavior and artifact model.

---

## Resolved decisions

These decisions were resolved during plan review:

1. **Harness runtime:** ✅ Shell wrapper (`scripts/test-api-docker.sh`) for Docker lifecycle + Bun (`scripts/run-api-suite.ts`) for test execution and reporting.
2. **Test framework:** ✅ `bun:test` under `tests/api/`, consistent with existing test suites.
3. **Test result aggregation:** ✅ Sidecar JSONL event records aggregated by `scripts/run-api-suite.ts`; do not rely on a Bun JSON reporter.
4. **Test framework location:** ✅ `tests/api/` (new directory, parallel to `tests/unit/` and `tests/integration/`).
5. **Fixture strategy:** ✅ Docker Compose fixture server as primary; `data:` URLs for trivial single-page cases only; external sites tagged `@external` and optional.
6. **Run isolation:** ✅ Each run gets a unique run ID, Compose project name, and run-scoped runtime directories/config.
7. **Report generation:** ✅ Repo-local HTML generator borrowing visual-explainer design language. No external skill dependency.
8. **Packaging format:** ✅ Plain folder under `test-results/`. Archive packaging deferred to later iteration.
9. **Baseline telemetry:** ✅ Required in first implementation for structured logs, IDs, and timings. OTLP fake-collector verification may be feature-flagged.
10. **Skill packaging:** ✅ Conventional `skills/` directory discovery is the runtime discovery mechanism; optional package metadata is a separate shipping concern.
11. **Result directory:** ✅ `test-results/` (separate from `output/`, with run-local runtime state nested inside the run folder).

## Remaining open decisions

1. **Malformed JSON contract:** fix in production API before suite implementation, or document current behavior and stage the fix first?
2. **Optional package metadata:** add Pi package metadata in `package.json` for shipping clarity, or keep packaging minimal?
3. **Fixture server port:** `4444` proposed — currently appears free on the local machine, but confirm it remains acceptable for the project.

---

## Reviewer summary

This plan proposes a **container-first QA workflow** for shuvcrawl that upgrades testing from smoke-checks to a **broad black-box API validation system** with strong evidence capture, a **visual review artifact**, and a **bundled autonomous agent skill**.

The recommended shape is:

- **Shell wrapper + Bun runner** — shell manages Docker lifecycle with trap cleanup; Bun handles test execution, JSONL aggregation, and HTML report generation
- **Run-scoped isolation** — every run gets its own Compose project name, config, output, cache, browser profile, and job DB
- **Docker Compose fixture server** — sibling container on the same network so the shuvcrawl browser can reach deterministic test pages
- **`bun:test` API suite** under `tests/api/` — consistent with existing test conventions
- **Artifact-rich `test-results/` output** — machine- and human-readable, with runtime state captured inside the run folder
- **Self-contained HTML visual report** — repo-local generator using visual-explainer design language
- **Conventional `skills/shuvcrawl/` skill** — auto-discovered by Pi via `skills/`, with packaging docs reconciled against repo guidance

This gives both humans and AI agents a much stronger operational surface around shuvcrawl without requiring a redesign of the core engine.
