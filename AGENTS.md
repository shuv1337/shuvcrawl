# shuvcrawl — Project Guidance

## Overview

shuvcrawl is a Bun/TypeScript scraping toolkit that combines Patchright (undetected Playwright) with the Bypass Paywalls Clean extension. It exposes both a CLI and a Hono-based REST API, with Docker packaging for self-hosted deployment.

## Current Architecture

- `src/index.ts` — CLI entrypoint (`commander`)
- `src/server.ts` — API server entrypoint (`Bun.serve` + Hono app)
- `src/api/*` — request schemas, auth middleware, route handlers, error mapping
- `src/core/*` — scrape/map/crawl/capture engine, browser pool, async crawl job registry
- `src/storage/*` — output writing, cache, crawl state, SQLite-backed job persistence
- `src/utils/*` — logger, telemetry, robots parsing, rate limiting, URL helpers
- `tests/unit/*` — focused unit coverage
- `tests/integration/*` — real-browser integration coverage
- `tests/api/*` — Docker-backed black-box API coverage and artifact capture
- `tests/fixtures/*` — deterministic fixture server + static pages for API tests
- `scripts/test-api-docker.sh` / `scripts/run-api-suite.ts` — container-first API harness + report generation
- `docker-compose.yml` / `docker-compose.test.yml` / `Dockerfile` — containerized API deployment and test overlay

## Key Runtime Details

- Default API port: `3777`
- Docker service name: `shuvcrawl`
- Output dir: `./output`
- Persistent app state: `~/.shuvcrawl` inside the container, backed by the `shuvcrawl-data` volume
- Crawl jobs are persisted to SQLite via `src/storage/job-store.ts`
- Telemetry exporter is OTLP HTTP when configured via `SHUVCRAWL_TELEMETRY_OTLPHTTPENDPOINT`

## Common Commands

### Development

```bash
bun install
bun run typecheck
bun test
bun run test:integration
bun run test:all
```

### Local API

```bash
bun run serve -- --port 3777
curl http://localhost:3777/health
```

### Docker

```bash
docker compose up -d --build
curl http://localhost:3777/health
docker compose logs -f shuvcrawl
docker compose down
```

### Existing Smoke Test

```bash
./scripts/docker-smoke.sh
```

### Docker API Harness

```bash
bun run test:api
./scripts/test-api-docker.sh --verify-otlp --open-report
```

## Validation Expectations

When changing API, Docker, scraping, or test harness code, prefer the lightest meaningful validation:

1. `bun run typecheck`
2. targeted `bun test ...` suites
3. `bun run test:integration` when browser behavior changes
4. `bun run test:api` when container/runtime/API-boundary behavior changes
5. Docker smoke when a minimal sanity check is sufficient

## Project Conventions / Gotchas

- Prefer deterministic tests against local fixtures over public internet targets.
- Keep long-running processes out of plain shell foreground runs; use Docker detached mode or an interactive harness when appropriate.
- New features should include telemetry/logging from day one.
- Complex result summaries should be rendered as HTML reports rather than terminal tables.
- Docker API test runs write isolated state to `test-results/<run-id>/runtime/`; do not reuse that state across runs.
- If adding a packaged AI skill, prefer an Agent Skills-compatible layout under `skills/`. Pi runtime discovery uses the conventional `skills/` directory; optional `package.json` metadata may be added for shipping clarity, but should not be treated as the primary discovery mechanism.

## Docs to Check First

- `README.md` — current usage and endpoint surface
- `HANDOFF.md` — latest implementation status and known issues
- `shuvcrawl-spec.md` — product/feature intent
- `PLAN-mvp.md` — prior implementation plan context
