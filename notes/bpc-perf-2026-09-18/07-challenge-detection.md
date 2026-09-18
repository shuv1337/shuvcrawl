# Challenge / consent / login detection for BPC short-HTML failures

Scope: research only. No live scrapes were run.

## Symptom to classify

Observed failure shape: `metadata.bypassMethod` is still `bpc-extension`, `metadata.title` is only the registrable domain (`nytimes.com`, `wsj.com`), extracted content is empty, and returned raw HTML is about 1.5k. The successful WaPo case instead had a real headline and multi-kilobyte article content.

## Current shuvcrawl behavior

There is no challenge/consent/login classifier in the core extraction path.

Relevant code paths:

- `src/core/scraper.ts:226-265` uses the browser+BPC path when fast-path does not provide HTML, captures `await browser.page.content()`, and labels the result `bpc-extension` unless `options.noBpc` is set.
- `src/core/extractor.ts:53-72` tries Readability and then falls back to full body text. It does not inspect challenge/login/consent strings, title/host mismatches, HTML length, final URL, forms, or status-like markers.
- `src/core/converter.ts:13-22` only strips scripts/styles/no-script/iframes/etc. and converts the extracted HTML to Markdown; it does not classify a failure page.
- `src/core/metadata.ts:92` sets status to `success` when `wordCount > 0` and otherwise `partial`. Although the type allows `blocked` (`src/core/metadata.ts:24`), the builder never emits `blocked` for challenge/auth/consent pages.
- `src/core/bpc.ts:12-31` only prepares extension storage/launch flags. It has no post-navigation signal that BPC actually unlocked the article.
- `src/core/page-goto.ts:15-30` has networkidle fallback-to-load handling, but no semantic page-quality check after load.
- `src/core/fast-path.ts:69-72` accepts fast-path HTML solely by HTTP OK plus `minContentLength`; it also has no challenge classifier.
- `src/api/schemas.ts:3-23` already exposes the knobs needed for diagnostic retries: `noFastPath`, `noBpc`, `noCache`, `wait`, `waitFor`, `waitTimeout`, `sleep`, `rawHtml`, and `onlyMainContent`.
- `src/storage/cache.ts:29-44` includes `wait`, `waitFor`, `sleep`, `onlyMainContent`, `rawHtml`, `fastPath`, and `bpc` in the cache key, so retry variants naturally get different cache keys; still use `noCache` while diagnosing to avoid replaying a bad cached partial.

Implication: a short challenge page can be reported as a normal scrape result with `bypassMethod: "bpc-extension"` and `status: "partial"` (or even `success` if the challenge body has words). BPC presence is not proof of bypass success.

## VoiceStudio gap

`backend/services/spoken_article.py` currently has only text/title pattern checks and an empty-text check:

- `_PAYWALL_PATTERNS` covers a small set of subscription/login prose (`spoken_article.py:33-45`).
- `_looks_auth_blocked(text, title)` checks only those patterns in title+text (`spoken_article.py:186-188`).
- `_is_empty_article(text)` is a pure empty-string test (`spoken_article.py:191-192`).
- `_fetch_from_scrape_payload` extracts `html = item.html || item.rawHtml` and `text = item.markdown || item.text || item.content`, but discards all shuvcrawl metadata/meta fields (`spoken_article.py:245-253`).
- `_capture_url` uses self-hosted shuvcrawl first, but if the parsed article text is empty it silently skips that result and falls through to direct `httpx` (`spoken_article.py:486-501`).
- `_process_article` reports `auth_required` only after `_looks_auth_blocked`; otherwise empty text becomes `extract_empty` (`spoken_article.py:503-522`).

So a BPC domain-title / ~1.5k raw-HTML / empty-content result is treated as an empty extraction, not as a challenge/login/consent diagnostic. Because the shuvcrawl result is skipped before processing, the UI loses the useful BPC metadata (`bypassMethod`, title, rawHtml length, status) and the direct `httpx` fallback can mask the original browser/BPC failure mode.

## Proposed detection signals

Use a combined classifier rather than any single signal. Flag as `suspected_challenge_or_auth` when two or more weak signals are present, or when one high-confidence known challenge string is present.

1. **Domain-only title**: normalized extracted title equals the request/final registrable domain or hostname (examples: `nytimes.com`, `www.nytimes.com`, `wsj.com`), especially when no `og:title`/article headline is present.
2. **Short browser HTML**: `rawHtml.length` is suspiciously small for a rendered article, e.g. `< 2500` bytes; the observed failure is ~1.5k while the successful WaPo content was much larger.
3. **Empty or tiny extracted article**: `content.trim()` / markdown empty, `metadata.wordCount === 0`, or text length below a floor such as 200 chars after boilerplate stripping.
4. **BPC browser path with poor article output**: `metadata.bypassMethod === "bpc-extension"` plus empty/tiny content. This indicates the extension was loaded, not that it solved the page.
5. **Generic challenge strings in raw HTML or visible text**: `Just a moment`, `Checking your browser`, `verify you are human`, `enable JavaScript and cookies`, `Attention Required`, `Access denied`, `unusual traffic`, `automated access`, `captcha`, `cf-chl`, `cf_clearance`, `challenge-platform`, `datadome`, `perimeterx`, `px-captcha`, `akamai`, `bot detection`, `blocked`, `request unsuccessful`.
6. **Consent/privacy wall strings**: `consent`, `privacy choices`, `accept all cookies`, `cookie preferences`, `OneTrust`, `Didomi`, `TrustArc`, `Sourcepoint`, `Quantcast Choice`, `gdpr`, `ccpa`, especially if paired with short HTML and no article text.
7. **Login/subscription strings broader than current VoiceStudio patterns**: `sign in`, `log in`, `subscribe`, `create an account`, `continue reading`, `already a subscriber`, `for subscribers`, `registration required`, `unlock article`, `paywall`.
8. **No article metadata**: missing `canonicalUrl`, `publishedAt`, article LD+JSON, `article:published_time`, and `og:title` while title is host/domain.
9. **Final URL/auth redirect hints**: final URL path or query contains `/login`, `/signin`, `/subscribe`, `/account`, `/auth`, `/consent`, `/privacy`, `/challenge`, `/captcha`, `/verify`, or host changes to a known auth/consent/challenge provider.
10. **Clean/raw mismatch**: raw HTML non-empty but extracted clean HTML/markdown empty, which points to a non-article shell or a page composed of stripped scripts/challenge markup.

Suggested diagnostic payload fields for shuvcrawl/Spoken Article logs: `source=self_hosted_shuvcrawl`, `bypassMethod`, `status`, `title`, `finalUrl`, `htmlLen`, `rawHtmlLen`, `contentLen`, `wordCount`, `waitStrategy`, `cacheHit` if available, and `challengeSignals`.

## Retry matrix for a later test phase

All retries should be gated by the classifier above, use `rawHtml: true`, collect `metadata` plus HTML/content lengths, and set `noCache: true` to avoid preserving a bad partial. Stop as soon as a retry produces a non-domain title and article-sized content.

| Step | Options | Purpose | Expected diagnostic |
| --- | --- | --- | --- |
| 0. Baseline capture | `{ rawHtml: true, onlyMainContent: true, noCache: true }` | Reproduce the normal self-hosted shuvcrawl path. | Confirms baseline title/content/html lengths and `bypassMethod`.
| 1. Browser-only BPC, no static shortcut | `{ rawHtml: true, onlyMainContent: true, noFastPath: true, noCache: true }` | Ensure fast-path did not supply or cache a short HTML shell before BPC. | If fixed, fast-path/static response was the bad source; if still short, browser/BPC render is suspect.
| 2. Post-load sleep | `{ rawHtml: true, onlyMainContent: true, noFastPath: true, noCache: true, wait: "sleep", sleep: 3000 }` then optionally `sleep: 8000` | Give BPC/client scripts/consent redirects time after load. | If title becomes headline/content grows, add a short sleep retry for suspected BPC pages.
| 3. Network idle | `{ rawHtml: true, onlyMainContent: true, noFastPath: true, noCache: true, wait: "networkidle", waitTimeout: 10000 }` | Wait for SPA/article async requests. `gotoPage` already falls back to `load` if initial networkidle times out (`page-goto.ts:25-27`). | If it falls back or still short, network idle is not enough; log fallback.
| 4. Full body extraction | `{ rawHtml: true, onlyMainContent: false, noFastPath: true, noCache: true, wait: "sleep", sleep: 3000 }` | Distinguish extractor failure from true page/challenge failure. `onlyMainContent: false` uses body text directly (`extractor.ts:42-50`). | If full body has article text, Readability/main-content extraction is the issue; if not, capture is blocked.
| 5. Direct no-BPC control | `{ rawHtml: true, onlyMainContent: true, noFastPath: true, noBpc: true, noCache: true, wait: "sleep", sleep: 3000 }` | Compare extension-loaded browser versus plain browser. | If same title/HTML length, BPC did not change the rendered page; if worse, BPC may be partially helping.
| 6. Mobile viewport probe | `{ rawHtml: true, onlyMainContent: true, noFastPath: true, noCache: true, mobile: true, wait: "sleep", sleep: 3000 }` | Some publisher templates/challenges differ on mobile. | If mobile succeeds, retry or UI advice can prefer mobile for that domain.
| 7. Selector wait only when a known selector exists | `{ rawHtml: true, onlyMainContent: true, noFastPath: true, noCache: true, wait: "selector", waitFor: "article", waitTimeout: 10000 }` or domain-specific selectors | Avoid blind waits when the article element eventually appears. | Timeout is a signal that the article DOM never materialized.
| 8. Debug artifact run | Same as the most informative failing option plus `debugArtifacts: true` | Preserve raw HTML/screenshot/console where configured for offline diagnosis. | Confirms whether the page is a visible challenge, consent wall, login wall, or empty shell.

For Spoken Article specifically, do not immediately fall through to `httpx` when self-hosted shuvcrawl returns this suspected BPC-failure shape. Prefer: classify it, run at most one or two cheap shuvcrawl retries (`noFastPath+noCache+sleep`, then `noFastPath+noCache+networkidle` or `onlyMainContent:false`), and if still failing emit a blocked event such as `code: "browser_challenge_or_auth"` with diagnostic fields rather than losing the browser/BPC evidence.
