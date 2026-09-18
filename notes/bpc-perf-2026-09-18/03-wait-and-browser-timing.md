# BPC wait and browser timing: NYT 279ms scrape.browser.success

Research-only notes from code inspection. No live scrapes were run.

## Short conclusion

`scrape.browser.success elapsed=279ms` is measuring only the browser stage inside `scrapeUrl`: `page.goto(...)`, the configured post-navigation wait strategy, and `page.content()`. It does **not** include browser/session acquisition, BPC seeding, extraction, markdown conversion, or VoiceStudio-side work.

For the current Spoken Article payload:

```json
{"rawHtml": true, "onlyMainContent": true}
```

there is no requested wait, no `noFastPath`, and no `noCache`. On the browser path, shuvcrawl defaults to `wait: "load"`; after the load event it applies no additional wait. A 279ms successful browser stage therefore means shuvcrawl got a load event quickly and immediately serialized the DOM. That is too short to prove that BPC had time to rewrite a paywall page.

## Relevant code path

### VoiceStudio adapter payload and timeout

`/home/shuv/repos/VoiceStudio/backend/services/spoken_article.py`:

- `FirecrawlAdapter._scrape()` builds the shuvcrawl fallback payload as:

  ```python
  shuvcrawl_payload = {"url": url, "options": {"rawHtml": True, "onlyMainContent": True}}
  ```

- It tries `${base}/v2/scrape`, `${base}/v1/scrape`, then `${base}/scrape`.
- The HTTP client is:

  ```python
  httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=5.0))
  ```

So a later shuvcrawl wait experiment must keep the service response comfortably under the VoiceStudio adapter's ~60s request timeout.

### API options are optional

`/home/shuv/repos/shuvcrawl/src/api/schemas.ts` defines `wait`, `waitFor`, `waitTimeout`, and `sleep` as optional for `/scrape`; it does not default them in the API schema.

### Browser scrape default wait

`/home/shuv/repos/shuvcrawl/src/core/scraper.ts`:

```ts
waitStrategy = options.wait ?? 'load';
const timeout = options.waitTimeout ?? config.browser.defaultTimeout;
const gotoWait = waitStrategy === 'networkidle' ? 'networkidle' : 'load';
const navigated = await gotoPage(browser.page, url, gotoWait, timeout);
...
await applyWaitStrategy(browser.page, waitStrategy, ...);
...
html: await browser.page.content(),
finalUrl: browser.page.url(),
```

`applyWaitStrategy()` behavior:

- `load`: no-op; `gotoPage()` already waited for the load event.
- `networkidle`: waits for `page.waitForLoadState('networkidle')` using `waitTimeout` or browser default timeout.
- `selector`: waits for `waitFor` selector if present.
- `sleep`: waits for `sleep` ms if `sleep` is truthy.

Important gotcha: `sleep` only sleeps when `wait: "sleep"` is set. Supplying `sleep` without `wait: "sleep"` changes the cache key but is ignored by `applyWaitStrategy()` because the default strategy remains `load`.

### Navigation helper behavior

`/home/shuv/repos/shuvcrawl/src/core/page-goto.ts`:

- `gotoPage(page, url, 'load', timeout)` does a normal `page.goto(url, { waitUntil: 'load', timeout })`.
- `gotoPage(page, url, 'networkidle', timeout)` tries `waitUntil: 'networkidle'`.
- If `networkidle` times out, it falls back to `page.waitForLoadState('load')` and reports fallback; `scraper.ts` then changes `waitStrategy` to `load`, so there is no additional networkidle wait after fallback.

### Timing log scope

`/home/shuv/repos/shuvcrawl/src/utils/telemetry.ts` logs `<stage>.start` before the measured function and `<stage>.success` after it resolves with `Date.now() - startedAt`.

The measured `scrape.browser` block starts **after** `browserPool.acquire(...)` returns. That matters because browser launch, profile setup, extension load, and BPC storage seeding are outside the 279ms. The 279ms is not the whole browser path; it is just navigation + wait + DOM serialization.

## Does 279ms mean about:blank, cached error, blocked request, or real navigation?

Most likely: a real browser navigation to a very fast response or interstitial/block/paywall shell, followed immediately by DOM serialization after the load event.

Why:

- If shuvcrawl storage cache had hit, `scrapeUrl()` would return before the browser block and there would be no `scrape.browser.start` / `scrape.browser.success` pair. So this was not a shuvcrawl cache hit.
- If `page.goto(url)` had failed at the Playwright/navigation level, `measureStage()` would log `scrape.browser.failed`, not `success`.
- The browser page is initialized to `about:blank` during acquisition, but the measured block calls `gotoPage(browser.page, url, ...)` before `page.content()`. A successful browser stage therefore means the navigation call resolved. It should not remain `about:blank` unless the requested URL itself was `about:blank` or a very unusual navigation edge case occurred; the target URL in this path is the normalized article URL.
- Browser-internal cached content is possible in general, but this pool creates/releases a runtime profile per scrape in the normal Docker path and closes a fresh context in the native path. The observed log is much more consistent with a fast server response, fast error page, fast paywall shell, or block page than a durable cache hit.
- BPC may be loaded/seeded before this point, but with default `wait: "load"` shuvcrawl does not intentionally wait for BPC's content scripts, redirects, or DOM rewrites after the page load event.

The decisive evidence would be `finalUrl`, `rawHtml`, title, status text, and artifacts/console logs from that same request. The timing alone does not distinguish a real article page from a soft-block/paywall page; it only says the load event plus DOM serialization completed quickly.

## Wait options that actually give BPC time

For a paywall-site experiment, use a payload that forces the browser/BPC path and adds a fixed post-load dwell:

```json
{
  "rawHtml": true,
  "onlyMainContent": true,
  "noFastPath": true,
  "noCache": true,
  "wait": "sleep",
  "sleep": 5000,
  "waitTimeout": 30000
}
```

If 5s is not enough, try 8000ms sleep while keeping the overall request inside VoiceStudio's 60s budget:

```json
{
  "rawHtml": true,
  "onlyMainContent": true,
  "noFastPath": true,
  "noCache": true,
  "wait": "sleep",
  "sleep": 8000,
  "waitTimeout": 30000
}
```

Rationale:

- `noFastPath: true` prevents a successful fast-path fetch from skipping the browser entirely.
- `noCache: true` prevents returning a previously cached bad/partial result during experiments.
- Leaving `noBpc` unset keeps the intended BPC browser path. In the current scraper code, `noBpc` mainly affects metadata; the browser pool loads BPC from config/server setup, but the experiment should still avoid asking for no-BPC behavior.
- `wait: "sleep"` is the only supported single option that gives a guaranteed post-load dwell for extension work.
- `sleep` without `wait: "sleep"` will not dwell.
- `networkidle` is a poor default for NYT-like, ad-heavy pages. It may wait a long time, or time out and fall back to `load`; after fallback the scraper does not add a fixed dwell, so it still may not give BPC time.
- `selector` can be useful only if a reliable selector exists for the desired final DOM. It cannot currently be combined with a sleep in shuvcrawl's single `wait` enum, and generic article selectors may appear on paywall shells too.

## Timeout interaction

Shuvcrawl defaults `config.browser.defaultTimeout` to `30_000` ms. `waitTimeout` overrides that for both `page.goto(...)` and selector/networkidle waits. For `wait: "sleep"`, `waitTimeout` bounds the initial load navigation; the sleep itself is a separate fixed delay.

VoiceStudio's adapter uses an HTTPX 60s timeout for the scrape call. To avoid tripping it, leave room for:

- v2/v1 probe attempts before `/scrape` (usually fast 404/405 on shuvcrawl),
- robots preflight (can take up to ~5s on a miss),
- browser/context acquisition if not already warm,
- page load up to `waitTimeout`,
- fixed `sleep`,
- extraction/conversion/output serialization.

Recommended experiment budget: `waitTimeout: 30000` plus `sleep: 5000` or `8000`. Avoid `waitTimeout: 60000` from VoiceStudio because the service could still be inside navigation/wait when the adapter gives up. If more dwell is needed later, raise sleep gradually and either keep `waitTimeout` lower or increase the VoiceStudio adapter timeout deliberately in the same experiment.
