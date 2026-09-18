# Robots policy and `noRobots` for WSJ-class Spoken Article scrapes

Date: 2026-09-18 PDT

## Scope

Research-only note. I did not run live scrapes. This reads shuvcrawl and the VoiceStudio Spoken Article adapter to answer:

- whether single-page scrapes respect `robots.txt` by default;
- whether `noRobots` is request-scoped or global;
- whether Spoken Article should pass `noRobots` for WSJ-class sites in a later experiment.

## Findings

### Single scrape respects robots by default

`src/core/scraper.ts` runs a robots preflight before fast path or browser/BPC work:

```ts
const preflight = await measureStage(logger, 'scrape.preflight', telemetry, async () => {
  return await allowByRobots(url, options.noRobots ? false : config.crawl.respectRobots);
});
if (!preflight.result.allowed) {
  throw new Error(preflight.result.reason ?? 'robots denied');
}
```

So the observed default WSJ scrape result (`HTTP 403`, `success=false`, `robots.txt: Disallow /`, ~0.01s) is consistent with code: shuvcrawl stops at the preflight and never reaches fast path or BPC.

`src/utils/robots.ts` implements this as a preflight-only policy gate:

- if `respectRobots` is false, `allowByRobots` immediately returns allowed;
- it fetches `{origin}/robots.txt` with `User-Agent: shuvcrawl/1.0 (+https://github.com/shuv/shuvcrawl)`;
- a 404, failed fetch, empty robots file, or parse problem allows by convention;
- a matching disallow returns a reason like `robots.txt: Disallow /`.

`tests/unit/robots.test.ts` covers the bypass case (`respectRobots=false`) and matching disallow behavior.

### The default is global respect, including docker-compose

The config schema default is `crawl.respectRobots: true` in `src/config/schema.ts`.

The env loader maps nested env vars, so `SHUVCRAWL_CRAWL_RESPECTROBOTS=false` becomes `config.crawl.respectRobots=false`; `tests/unit/config-loader.test.ts` covers that exact env var.

`docker-compose.yml` explicitly supplies:

```yaml
SHUVCRAWL_CRAWL_RESPECTROBOTS=${SHUVCRAWL_CRAWL_RESPECTROBOTS:-true}
```

So the compose default is to respect robots globally.

### `noRobots` is request-scoped for scrape/map/capture, not a config mutation

For single scrape, `noRobots` is part of `ScrapeOptions` and only changes the argument passed to `allowByRobots` for that request. It does not mutate `config.crawl.respectRobots`.

API schemas accept `options.noRobots` on:

- `/scrape` (`ScrapeRequestSchema`);
- `/map` (`MapRequestSchema`);
- `/crawl` (`CrawlRequestSchema`);
- `/screenshot`;
- `/pdf`.

The local Python `sc` wrapper also exposes `--no-robots` for scrape/map/crawl/screenshot/pdf and sends `options.noRobots: true`.

The TypeScript commander CLI commands currently do **not** expose/pass `noRobots` for scrape/map/crawl, but VoiceStudio uses the HTTP adapter path, not those commander commands.

### Crawl differs from single scrape

`src/core/crawl.ts` currently defines `CrawlOptions` without `noRobots` and calls `scrapeUrl` without forwarding `options.noRobots`:

```ts
const scrape = await scrapeUrl(next.url, {
  noFastPath: options.noFastPath,
  noBpc: options.noBpc,
  noCache: options.noCache,
  wait: options.wait,
  waitFor: options.waitFor,
  waitTimeout: options.waitTimeout,
  sleep: options.sleep,
  debugArtifacts: options.debugArtifacts,
} satisfies ScrapeOptions, config, logger, telemetry, browserPool);
```

Because JavaScript will carry an extra `noRobots` field from the API payload at runtime but `crawlSite` does not forward it into each `scrapeUrl` call, `/crawl`'s schema-level `noRobots` appears ineffective for the actual per-page robots preflight. The global `crawl.respectRobots` config still applies.

That distinction matters: **single `/scrape` can bypass robots request-by-request; multi-page `/crawl` cannot currently do that unless the global config is changed or code is updated.**

### VoiceStudio Spoken Article currently does not pass `noRobots`

`/home/shuv/repos/VoiceStudio/backend/services/spoken_article.py` sends this shuvcrawl payload when probing the self-hosted adapter fallback:

```py
shuvcrawl_payload = {"url": url, "options": {"rawHtml": True, "onlyMainContent": True}}
```

Tests assert that exact payload. Spoken Article also calls self-hosted shuvcrawl before the plain `httpx` fetch. Therefore a WSJ-class URL with `Disallow: /` will fail at shuvcrawl robots preflight unless the global server config disables robots or the payload adds `options.noRobots: true`.

The user-provided observation fits this:

- default scrape: immediate robots denial;
- `noRobots + noFastPath`: BPC/browser path ran, but still extracted 0 content.

That means `noRobots` is sufficient to get past shuvcrawl's robots gate for `/scrape`, but the remaining empty result is a separate BPC/paywall/extraction problem.

## Product/legal interpretation

`noRobots` is not stealth malware and does not alter browser fingerprints or bypass authentication by itself. It only disables shuvcrawl's local robots preflight for a specific request, when used through `/scrape`.

Still, ignoring robots is a product/legal policy decision. The safer default posture is:

- keep `SHUVCRAWL_CRAWL_RESPECTROBOTS=true`;
- keep generic Spoken Article behavior robots-respecting by default;
- do not disable robots globally for the service;
- do not use `/crawl` for WSJ-class sites as a workaround;
- if owner-approved, run a controlled single-article experiment with `noRobots` on the local `/scrape` request only.

## Recommendation

For WSJ-class **user-submitted single article narration**, Spoken Article should be allowed to pass `noRobots: true` only as a narrow, local, scrape-scoped toggle/experiment after explicit product/legal acceptance. It should not become a global service default, and it should not be applied to broad crawls.

For the next experiment, change only the self-hosted shuvcrawl `/scrape` payload used by Spoken Article, e.g.:

```py
shuvcrawl_payload = {
    "url": url,
    "options": {
        "rawHtml": True,
        "onlyMainContent": True,
        "noRobots": True,
        "noFastPath": True,
    },
}
```

Why include both toggles for the experiment:

- `noRobots: true` proves the robots gate is not the blocking cause;
- `noFastPath: true` forces the browser/BPC path, matching the observed WSJ-class diagnostic;
- keeping this in the `/scrape` request avoids changing compose/global policy;
- if content is still empty, the next investigation should focus on BPC coverage, page state, auth/paywall handling, extraction selectors/artifacts, and whether the page is actually accessible to the local browser session.

If the product wants this beyond a one-off experiment, make it explicit in VoiceStudio settings/copy as a local advanced option for user-requested article narration, not an invisible default for all article URLs.
