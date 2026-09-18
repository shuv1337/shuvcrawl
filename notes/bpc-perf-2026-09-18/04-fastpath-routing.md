# Fast-path routing vs browser/BPC routing

## Bottom line

Shuvcrawl's `/scrape` has two mutually exclusive routes for normal article capture:

1. **Fast path**: direct `fetch()` with configured headers.
2. **Browser path**: Patchright browser session with the BPC extension loaded/seeded.

BPC only gets a chance on the browser path. Therefore any fast-path result accepted as `content-length-ok` is **not** a BPC result, even when the caller did not pass `noBpc`.

For hard paywall hosts where the product intent is "let BPC run", Spoken Article should call self-hosted shuvcrawl with `options.noFastPath: true` for those hosts.

## Code evidence

### Fast-path acceptance rule

`src/core/fast-path.ts` builds a direct request with the configured fast-path user agent and referer, lets caller headers override those defaults, follows redirects, reads the response body, and accepts only on status and body length:

- Headers: `user-agent: config.fastPath.userAgent`, `referer: config.fastPath.referer`, then `...customHeaders` (`src/core/fast-path.ts:53-58`).
- Fetch: `fetch(url, { headers, redirect: 'follow', ...tlsOptions })` (`src/core/fast-path.ts:63-70`).
- Accept: `response.ok && html.length >= config.fastPath.minContentLength` (`src/core/fast-path.ts:71`).
- Reason: accepted -> `content-length-ok`; rejected -> `rejected:${response.status}:${html.length}` (`src/core/fast-path.ts:72`).

The defaults are:

- `fastPath.enabled: true`
- `fastPath.userAgent: Googlebot/2.1 (+http://www.google.com/bot.html)`
- `fastPath.referer: https://www.google.com/`
- `fastPath.minContentLength: 500`

Defined in `src/config/schema.ts:44-50`.

### Routing rule

`scrapeUrl()` runs robots preflight, then tries fast path when both conditions are true:

- request did not set `options.noFastPath`
- config has `fastPath.enabled`

See `src/core/scraper.ts:187-224`.

If fast path is accepted, shuvcrawl stores the fast-path HTML, final URL, and sets `bypassMethod = 'fast-path'` (`src/core/scraper.ts:208-217`). It does **not** launch the browser.

Only if `html` is still empty after fast path rejection/degradation does it acquire a browser session (`src/core/scraper.ts:226-279`). After browser navigation, metadata is set to `bpc-extension` unless the request set `noBpc` (`src/core/scraper.ts:263-266`).

API support for this is already present:

- `/scrape` accepts `options.noFastPath`, `options.noBpc`, `options.noCache`, `options.headers`, `options.rawHtml`, and `options.onlyMainContent` (`src/api/schemas.ts:3-23`).
- `/scrape` returns `meta.bypassMethod` from scrape metadata (`src/api/routes.ts:15-27`).

### Browser/BPC setup

On the Docker/local browser path, `BrowserPool` resolves the BPC extension path, launches Patchright with `--disable-extensions-except=<path>` and `--load-extension=<path>`, then seeds BPC storage state in the extension service worker:

- extension path + adapter construction: `src/core/browser.ts:108-129`
- extension flags in launch args: `src/core/browser.ts:216-249`
- `chrome.storage.local.set(...)` BPC seed: `src/core/browser.ts:263-282`
- BPC storage includes `sites_excluded`, `optIn`, `customOptIn`, and `optInUpdate`: `src/core/bpc.ts:15-31`

On the native browser server, BPC is loaded unless the server itself is started with `--no-bpc` (`src/native-browser-server.ts:37-40`).

## Consequences of the Googlebot fast path

Because fast path uses Googlebot + Google referer by default and only validates `response.ok` plus `html.length >= 500`, it has these consequences:

- A publisher can serve Googlebot a different document than a normal browser would see. If that document is over 500 bytes, shuvcrawl accepts it and never tests BPC.
- A publisher can block Googlebot. That yields a fast-path reject/degrade and falls through to browser/BPC, as observed with NYT `403:771`.
- A publisher can serve a paywall, interstitial, or auth/error page with HTTP 200 and more than 500 bytes. Shuvcrawl would accept it as `content-length-ok` and skip browser/BPC, because there is no semantic paywall/full-article check in `tryFastPath()`.
- An accepted fast path is useful for public/static pages, but it is not evidence that BPC worked. The Atlantic result with ~13k chars was `fast-path`; it should be treated as "Googlebot/direct fetch got enough text", not a BPC validation.

Do not add Googlebot headers from Spoken Article when forcing browser mode. Shuvcrawl's `options.headers` are also passed as browser `extraHTTPHeaders` (`src/core/scraper.ts:203-231`; `src/core/browser.ts:197-200`; `src/core/native-browser.ts:72-75`), so product-level headers can accidentally contaminate the browser route.

## VoiceStudio adapter gap

`backend/services/spoken_article.py` currently tries:

1. `POST {base}/v2/scrape` with Firecrawl payload `{url, formats: ['markdown', 'html'], onlyMainContent: true}`
2. `POST {base}/v1/scrape` with the same Firecrawl payload
3. `POST {base}/scrape` with shuvcrawl payload `{url, options: {rawHtml: true, onlyMainContent: true}}`

See `backend/services/spoken_article.py:280-290`.

For the shuvcrawl `/scrape` attempt, the adapter does **not** send `noFastPath`, `noBpc`, or `noCache`. With shuvcrawl defaults, fast path is enabled, so a hard-paywall host can be accepted as `content-length-ok` before the browser/BPC route runs.

The adapter also collapses shuvcrawl output into `FetchResult` using only `html/rawHtml` and `markdown/text/content` (`backend/services/spoken_article.py:245-253`), so it discards `meta.bypassMethod` and cannot currently tell whether a result came from `fast-path` or `bpc-extension`.

Spoken Article capture order is self-hosted Firecrawl/shuvcrawl first, then `httpx` fallback, then cloud Firecrawl only if extraction was empty and `off_box == 'public-only'` (`backend/services/spoken_article.py:486-500`). In the WaPo case, this means a self-hosted shuvcrawl timeout/None can send the product down the slower `httpx` path instead of the known-good forced browser/BPC route.

## Host routing recommendation

Use a host policy in Spoken Article before building the self-hosted shuvcrawl payload:

- For known hard-paywall domains where the product intent is BPC, set `noFastPath: true`.
- Initially seed that denylist with:
  - `nytimes.com` / `www.nytimes.com`
  - `wsj.com` / `www.wsj.com`
  - `washingtonpost.com` / `www.washingtonpost.com`
- Match by normalized registrable domain/eTLD+1 or explicit suffix matching, so subdomains are covered.
- Keep fast path enabled for the general case. The Atlantic result shows fast path can be productive for some publishers, but it should not be used as a BPC proof.
- Optionally track a separate allowlist for hosts where Spoken Article is allowed to use fast path even on publisher sites. The safer first move is a small hard-paywall denylist, not a global fast-path disable.

## Recommended Spoken Article shuvcrawl payload

For hosts in the hard-paywall/browser-required list, send this to self-hosted shuvcrawl `/scrape`:

```json
{
  "url": "https://example.com/article",
  "options": {
    "noFastPath": true,
    "noBpc": false,
    "rawHtml": true,
    "onlyMainContent": true
  }
}
```

For debugging or route verification runs, add `"noCache": true` and read back `meta.bypassMethod`; expect `bpc-extension` for the browser path. For production narration, `noCache` is optional because the cache key already distinguishes `fastPath: false` from `fastPath: true` (`src/core/scraper.ts:109-125`).
