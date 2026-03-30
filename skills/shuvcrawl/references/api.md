# shuvcrawl API reference

## Base URL

Default local API: `http://localhost:3777`

## Authentication

If `SHUVCRAWL_API_TOKEN` is set, send:

```http
Authorization: Bearer <token>
```

## Endpoints

### `GET /health`
Returns service health, runtime config summary, BPC info, telemetry status, and rate limiter stats.

### `GET /config`
Returns redacted runtime config.

### `POST /scrape`
Request body:

```json
{
  "url": "https://example.com/article",
  "options": {
    "selector": "article",
    "noFastPath": false,
    "noBpc": false,
    "noCache": false,
    "mobile": false,
    "debugArtifacts": false,
    "wait": "networkidle",
    "waitFor": "#content",
    "waitTimeout": 30000,
    "sleep": 1000,
    "headers": { "x-test": "1" },
    "rawHtml": true,
    "onlyMainContent": true
  }
}
```

### `POST /map`
Request body:

```json
{
  "url": "https://example.com",
  "options": {
    "noFastPath": false,
    "noBpc": false,
    "include": ["https://example.com/**"],
    "exclude": ["https://example.com/private/**"],
    "sameOriginOnly": true,
    "source": "both",
    "wait": "load"
  }
}
```

### `POST /crawl`
Request body:

```json
{
  "url": "https://example.com",
  "options": {
    "depth": 2,
    "limit": 10,
    "include": ["https://example.com/**"],
    "exclude": [],
    "delay": 1000,
    "source": "links",
    "resume": false,
    "noFastPath": false,
    "noBpc": false,
    "noCache": false,
    "debugArtifacts": false,
    "wait": "load"
  }
}
```

### `GET /crawl/:jobId`
Returns job status and final result when complete.

### `DELETE /crawl/:jobId`
Cancels a running crawl job.

### `POST /screenshot`
Request body:

```json
{
  "url": "https://example.com",
  "options": {
    "fullPage": true,
    "wait": "load",
    "waitFor": "#app",
    "waitTimeout": 30000,
    "sleep": 500
  }
}
```

### `POST /pdf`
Request body:

```json
{
  "url": "https://example.com",
  "options": {
    "format": "A4",
    "landscape": false,
    "wait": "networkidle"
  }
}
```

## Error envelope

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid request payload",
    "details": {}
  },
  "meta": {}
}
```

Known codes:

- `INVALID_REQUEST`
- `NETWORK_ERROR`
- `TIMEOUT`
- `EXTRACTION_FAILED`
- `ROBOTS_DENIED`
- `RATE_LIMITED`
- `CONFIG_ERROR`
- `BROWSER_INIT_FAILED`
- `UNAUTHORIZED`
- `INTERNAL_ERROR`
