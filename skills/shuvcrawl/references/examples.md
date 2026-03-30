# shuvcrawl examples

## Quick scrape via CLI

```bash
bun run scrape -- https://example.com/article --json
```

## Map a site via CLI

```bash
bun run map -- https://example.com --source both --json
```

## Crawl with limits via CLI

```bash
bun run crawl -- https://example.com --depth 2 --limit 10 --delay 1000 --json
```

## Screenshot via CLI

```bash
bun run screenshot -- https://example.com --full-page --json
```

## PDF via CLI

```bash
bun run pdf -- https://example.com --format Letter --json
```

## Start local API with auth

```bash
SHUVCRAWL_API_TOKEN=secret123 bun run serve -- --port 3777
curl -H "Authorization: Bearer secret123" http://localhost:3777/health
```

## Scrape through API

```bash
curl -X POST http://localhost:3777/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer secret123" \
  -d '{
    "url": "https://example.com/article",
    "options": {
      "wait": "networkidle",
      "rawHtml": true,
      "onlyMainContent": true
    }
  }'
```

## Crawl and poll through API

```bash
JOB_ID=$(curl -s -X POST http://localhost:3777/crawl \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer secret123" \
  -d '{"url":"https://example.com","options":{"depth":2,"limit":5}}' | jq -r '.job.jobId')

curl -H "Authorization: Bearer secret123" \
  http://localhost:3777/crawl/$JOB_ID
```

## Docker start

```bash
docker compose up -d --build
curl http://localhost:3777/health
```

## Docker API suite

```bash
bun run test:api
# or
./scripts/test-api-docker.sh --verify-otlp --open-report
```
