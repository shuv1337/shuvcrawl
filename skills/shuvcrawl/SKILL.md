---
name: shuvcrawl
description: Use shuvcrawl for autonomous web scraping, link mapping, site crawling, screenshots, and PDFs via its CLI or local REST API. Trigger when the user wants structured scraping, page discovery, crawl jobs, browser-backed captures, or Dockerized scraping workflows with repeatable artifacts.
---

# shuvcrawl

Use this skill when an agent needs to scrape content, discover URLs, crawl a small site, capture screenshots, or render PDFs with shuvcrawl.

## When to use shuvcrawl

Prefer shuvcrawl when the task needs one or more of:

- clean article/content extraction into markdown + JSON
- browser-backed scraping with wait strategies
- link discovery from a page or sitemap
- multi-page async crawl jobs
- screenshot or PDF capture artifacts
- a local, self-hosted scraping API the agent can call repeatedly

## Operating modes

### CLI mode

Use for quick local one-off work.

Examples:

```bash
bun run scrape -- https://example.com --json
bun run map -- https://example.com --json
bun run crawl -- https://example.com --depth 2 --limit 10 --json
bun run screenshot -- https://example.com --json
bun run pdf -- https://example.com --json
```

### API mode

Use for structured automation, polling, and artifact-aware workflows.

Common endpoints:

- `GET /health`
- `GET /config`
- `POST /scrape`
- `POST /map`
- `POST /crawl`
- `GET /crawl/:jobId`
- `DELETE /crawl/:jobId`
- `POST /screenshot`
- `POST /pdf`

### Docker mode

Use when the service is not already running or when you need reproducible isolation.

```bash
docker compose up -d --build
curl http://localhost:3777/health
```

## Safe workflow

1. Check whether shuvcrawl is already available:

```bash
curl -sf http://localhost:3777/health
```

2. If not available, start it with Docker or locally:

```bash
docker compose up -d --build
# or
bun run serve -- --port 3777
```

3. Confirm health before sending scrape jobs.
4. Choose the narrowest operation that satisfies the task.
5. Save or inspect returned artifacts.
6. Only shut the service down if you started it for this task and no follow-up work is pending.

## Decision guide

- Use **scrape** for one page’s extracted content.
- Use **map** for URL discovery from a page or sitemap.
- Use **crawl** for multi-page async exploration with polling.
- Use **screenshot** for visual evidence.
- Use **pdf** for printable/exportable page capture.

## Request patterns

### Scrape

```bash
curl -X POST http://localhost:3777/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/article",
    "options": {
      "wait": "networkidle",
      "rawHtml": true,
      "onlyMainContent": true
    }
  }'
```

### Map

```bash
curl -X POST http://localhost:3777/map \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "options": {
      "source": "both",
      "include": ["https://example.com/**"]
    }
  }'
```

### Crawl

```bash
curl -X POST http://localhost:3777/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "options": {
      "depth": 2,
      "limit": 10,
      "delay": 1000,
      "source": "links"
    }
  }'
```

Poll:

```bash
curl http://localhost:3777/crawl/<jobId>
```

Cancel:

```bash
curl -X DELETE http://localhost:3777/crawl/<jobId>
```

### Screenshot

```bash
curl -X POST http://localhost:3777/screenshot \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "options": {
      "fullPage": true,
      "wait": "load"
    }
  }'
```

### PDF

```bash
curl -X POST http://localhost:3777/pdf \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "options": {
      "format": "A4",
      "landscape": false,
      "wait": "networkidle"
    }
  }'
```

## Wait strategies and heuristics

Use these request options carefully:

- `wait: "load"` — default for straightforward pages
- `wait: "networkidle"` — use for apps/pages with async fetches
- `wait: "selector"` with `waitFor` — best when a specific DOM signal indicates readiness
- `wait: "sleep"` with `sleep` milliseconds — fallback only when no reliable selector exists

Prefer `selector` over `sleep` when possible.

## Output interpretation

- scrape writes output under `output/<domain>/...`
- artifacts are written under `output/_artifacts/<requestId>/` unless config overrides them
- screenshot and pdf responses return artifact paths directly
- crawl returns `jobId` immediately; poll until terminal state
- `/config` returns redacted values, not live secrets

## Safety and guardrails

- Respect auth tokens. If `SHUVCRAWL_API_TOKEN` is required, send `Authorization: Bearer <token>`.
- Respect robots defaults unless the user explicitly asks to bypass them and policy allows it.
- Prefer bounded crawls: set `depth`, `limit`, `include`, and `exclude`.
- Avoid long, open-ended crawls without explicit user intent.
- Use `noCache` for verification-sensitive tasks when stale output is risky.
- For screenshots/PDFs, remember these are browser-backed and may be slower or fail on hostile pages.

## Failure handling

Common envelopes and meanings:

- `INVALID_REQUEST` — malformed JSON, bad schema, invalid URL, missing job
- `UNAUTHORIZED` — missing or wrong bearer token
- `NETWORK_ERROR` — DNS/TLS/network/navigation failure
- `TIMEOUT` — selector or navigation timeout
- `BROWSER_INIT_FAILED` — Chromium/extension launch failure
- `ROBOTS_DENIED` — blocked by robots policy

If a request fails:

1. inspect status code + `error.code`
2. reduce scope (single URL before crawl)
3. switch wait strategy if the page is JS-heavy
4. use screenshot/PDF for evidence when content extraction is ambiguous
5. retry only when the failure looks transient

## References

Read these when you need exact API or usage details:

- [references/api.md](references/api.md)
- [references/examples.md](references/examples.md)
