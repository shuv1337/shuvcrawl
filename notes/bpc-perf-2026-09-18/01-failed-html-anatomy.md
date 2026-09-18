# Failed HTML anatomy — NYT/WSJ BPC A/B captures

Date: 2026-09-18 PDT. Scope: saved artifacts and local logs only; no live scrape and no config/code changes.

## Finding

The ~1.5k-byte pages are not article shells, consent pages, login pages, or Cloudflare challenges. They are compact DataDome interstitial wrappers. The distinctive shape is:

- `<title>nytimes.com</title>` / `<title>wsj.com</title>`
- `var dd={... 'host':'geo.captcha-delivery.com' ...}`
- `https://ct.captcha-delivery.com/i.js`
- `<iframe ... title="DataDome Device Check" ... style="height:100vh;">`
- iframe `src` on `https://geo.captcha-delivery.com/interstitial/`

Saved request artifacts:

- NYT first noFastPath/BPC capture:
  - `/home/shuv/repos/shuvcrawl/output/www.nytimes.com/_meta.jsonl` line 13: `req_cedb87fb-59af-4047-9d9e-26b473251cb1`, `wordCount:0`, `status:"partial"`.
  - `/home/shuv/repos/shuvcrawl/output/_artifacts/req_cedb87fb-59af-4047-9d9e-26b473251cb1/raw.html`, 1565 bytes, contains `DataDome Device Check`, `geo.captcha-delivery.com`, `ct.captcha-delivery.com/i.js`, `var dd=`.
  - `/home/shuv/repos/shuvcrawl/output/_artifacts/req_cedb87fb-59af-4047-9d9e-26b473251cb1/clean.html`, 781 bytes, just the interstitial iframe.
  - `/home/shuv/repos/shuvcrawl/output/_artifacts/req_cedb87fb-59af-4047-9d9e-26b473251cb1/console.json`: `Failed to load resource: the server responded with a status of 403 ()` at the article URL, then `No available adapters.` from the DataDome iframe.

- NYT repeat noFastPath/BPC capture:
  - `/home/shuv/repos/shuvcrawl/output/www.nytimes.com/_meta.jsonl` line 14: `req_db92c923-4e9f-48dc-9b16-59835d486109`, `wordCount:0`, `status:"partial"`.
  - `/home/shuv/repos/shuvcrawl/output/www.nytimes.com/2026__09__16__business__economy__federal-reserve-interest-rates-warsh.html.json`: `content:""`, `html` length 781, `rawHtml` length 1565, title `nytimes.com`, `bypassMethod:"bpc-extension"`, `extractionMethod:"fullbody"`.
  - `/home/shuv/repos/shuvcrawl/output/_artifacts/req_db92c923-4e9f-48dc-9b16-59835d486109/raw.html`, 1565 bytes, same DataDome wrapper.
  - `/home/shuv/repos/shuvcrawl/output/_artifacts/req_db92c923-4e9f-48dc-9b16-59835d486109/clean.html`, 781 bytes, just the interstitial iframe.
  - `/home/shuv/repos/shuvcrawl/output/_artifacts/req_db92c923-4e9f-48dc-9b16-59835d486109/console.json`: `Failed to load resource: the server responded with a status of 403 ()` at the article URL, then `No available adapters.` from the DataDome iframe.

- WSJ noRobots/noFastPath/BPC capture:
  - `/home/shuv/repos/shuvcrawl/output/www.wsj.com/_meta.jsonl` line 3: `req_df85a02d-8ed8-43c8-8385-9924e923ffa2`, `wordCount:0`, `status:"partial"`.
  - `/home/shuv/repos/shuvcrawl/output/www.wsj.com/economy__weeks-before-the-midterms-almost-everything-is-getting-more-expensive-5b201bb5.json`: `content:""`, `html` length 799, `rawHtml` length 1579, title `wsj.com`, `bypassMethod:"bpc-extension"`, `extractionMethod:"fullbody"`.
  - `/home/shuv/repos/shuvcrawl/output/_artifacts/req_df85a02d-8ed8-43c8-8385-9924e923ffa2/raw.html`, 1579 bytes, contains `DataDome Device Check`, `geo.captcha-delivery.com`, `ct.captcha-delivery.com/i.js`, `var dd=`.
  - `/home/shuv/repos/shuvcrawl/output/_artifacts/req_df85a02d-8ed8-43c8-8385-9924e923ffa2/clean.html`, 799 bytes, just the interstitial iframe.
  - `/home/shuv/repos/shuvcrawl/output/_artifacts/req_df85a02d-8ed8-43c8-8385-9924e923ffa2/console.json`: `Failed to load resource: the server responded with a status of 401 ()` at the article URL, then `No available adapters.` from the DataDome iframe.

The WSJ default robots-denied run does not appear to have produced a saved WSJ scrape output artifact for tonight. `/home/shuv/repos/shuvcrawl/output/www.wsj.com/_meta.jsonl` contains the noRobots/BPC partial capture for tonight plus two older June partial captures; no robots/403/default artifact entry was found under that host output.

## Why extraction returned 0 content

The scraper did successfully hand HTML to the extractor, but the HTML was the challenge document, not an article document.

Relevant code path:

- `/home/shuv/repos/shuvcrawl/src/core/scraper.ts` lines 257-265: browser path returns `html: await browser.page.content()`, then labels it `bpc-extension` when BPC was enabled.
- `/home/shuv/repos/shuvcrawl/src/core/extractor.ts` lines 53-72: Readability is attempted; when it finds no text, extraction falls back to `document.body.innerHTML` with `textContent` from the body.
- `/home/shuv/repos/shuvcrawl/src/core/converter.ts` lines 13-22: markdown conversion strips `script`, `style`, and `iframe` elements before Turndown.

For these captures the body text is effectively empty: script text is not body text and the only visible payload is an iframe element with no article text in the parent DOM. Readability therefore fails, fallback `fullbody` produces an iframe-only `html`, and converter strips that iframe. Result: `content:""`, `wordCount:0`, `status:"partial"`.

## Ranked hypotheses

1. **DataDome blocked the browser session before any BPC article logic could matter.** Highest confidence. Both publishers returned the same DataDome interstitial pattern (`geo.captcha-delivery.com/interstitial`, `DataDome Device Check`, `var dd=`), and the browser console recorded upstream article-load failures (`403` for NYT, `401` for WSJ).

2. **BPC was loaded and seeded, but BPC is not an anti-bot bypass.** High confidence. Local logs show `browser.launch.options` with `/app/bpc-chrome`, `browser.extension.ready`, and `bpc.seed.snapshot` with `optIn:false`, `customOptIn:false`, `optInUpdate:true`, `sites_excluded:[]`. BPC site rules exist for both domains (`/home/shuv/repos/shuvcrawl/bpc-chrome/sites.js` lines 3220-3224 for NYT; lines 3351-3356 for WSJ), but those rules target paywall/meter/referrer behavior, not a DataDome device-check denial.

3. **The default Docker/Patchright fingerprint is being classified by DataDome.** Medium-high confidence. `/home/shuv/repos/shuvcrawl/src/core/native-browser.ts` comments explicitly call host-native browser/GPU/network/OS fingerprint critical for DataDome-like bot detection. The observed block happens fast: local logs around the saved requests show browser navigation completed in hundreds of milliseconds with challenge HTML already in place.

4. **WSJ robots handling is orthogonal to the 1.5k HTML.** Medium confidence. The default WSJ run failed at robots.txt (`Disallow /`) before browser capture, so it had no saved content artifact. The noRobots/noFastPath run bypassed that preflight and then hit DataDome. Robots avoidance changed whether the browser was reached; it did not solve the challenge.

5. **BPC mode/settings could influence site selection but are unlikely to be the root cause.** Lower confidence. BPC was seeded in conservative mode (`optIn:false`) with updated sites enabled. That is consistent with default behavior and the bundled site entries include both domains. Even if an aggressive/custom setting altered BPC behavior, the parent document was already a DataDome wrapper, so there was no article DOM for content scripts to repair.

## Later experiments to confirm

No live experiments were run here. A later experiment could confirm with:

1. Add non-invasive classification of captured HTML after scrape: flag `geo.captcha-delivery.com`, `DataDome Device Check`, `var dd=`, and `ct.captcha-delivery.com/i.js` as `challenge_datadome` instead of generic partial/empty content.

2. Compare the same URL across browser modes: current Docker Patchright+BPC, native browser mode, and a persistent warmed profile. Confirmation signal: DataDome wrapper only in the Docker/new-profile case, article DOM or non-DataDome denial in native/warmed profile.

3. Record response status and top-level response URL from `gotoPage` separately from `page.content()`. Confirmation signal: top-level NYT/WSJ response status matches console status (`403`/`401`) even though shuvcrawl returns HTTP 200 for the API request.

4. Probe BPC application without protected publisher pages by using a local fixture or a permitted test page that can detect extension content-script/webRequest behavior. Confirmation signal: BPC is loaded and functional independently of DataDome outcomes.

5. Run a noBPC/noFastPath/noRobots browser capture only in a controlled later test. Confirmation signal: if the HTML remains the same DataDome wrapper, BPC is not the cause; if it changes, BPC interaction affects fingerprint/request headers.

## Risks

- Misleading success semantics: API HTTP 200 plus `success:true` can mask publisher-side 401/403 challenge pages; downstream consumers may treat empty partial results as successful scrapes.
- Cache poisoning: partial DataDome captures can be cached or written over expected article output unless empty/challenge pages are classified and excluded from success paths.
- Compliance/authorization: noRobots can move a request past robots preflight into publisher anti-bot controls; future experiments should remain bounded and authorized.
- Overfitting BPC: tuning BPC settings will not address device-check classification if the upstream block is browser fingerprint/IP/session related.
- False negatives in extraction metrics: `extractionMethod:"fullbody"` with nonzero HTML length can still mean zero extractable content because converter strips iframe/script-only documents.
