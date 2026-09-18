# Native Chrome / profile cookies as a BPC performance path

Date: 2026-09-18 (PDT)

## Scope

Read-only code review of shuvcrawl's current browser/profile/BPC paths. No target-site scrape was run and no personal Chrome profile was attached.

Current reported runtime baseline:

- `SHUVCRAWL_BROWSER_HEADLESS=false`
- `SHUVCRAWL_BROWSER_NATIVE_ENABLED=false`
- `SHUVCRAWL_BROWSER_NATIVE_WSENDPOINT=ws://host.docker.internal:9224`
- health: `browser.headless=false`, `native.enabled=false`, `executablePath=null` → Patchright bundled Chromium, not system Chrome.

## Findings

### 1. Per-request runtime profiles do wipe cookies and runtime BPC state

`BrowserPool.createSession()` builds each browser session as:

1. Resolve `profileRoot`, `templateProfile`, and `runtimeProfileRoot`.
2. Compute `runtimeProfile = runtimeProfileRoot/<requestId>`.
3. If the template is missing or `browser.resetOnStart` is true, delete/recreate the template and launch once into it.
4. Delete any existing request runtime directory.
5. Copy template → request runtime.
6. Launch Patchright persistent context on the request runtime.
7. Seed BPC storage into that runtime's extension service worker.
8. On release, close the context and delete the request runtime directory.

Code references:

- `src/core/browser.ts:108-129` creates `runtime/<requestId>` from `templateProfile`.
- `src/core/browser.ts:140-143` deletes the runtime profile on release.
- `src/core/browser.ts:263-282` writes BPC storage into the runtime extension service worker.
- `src/core/scraper.ts:226-273`, `src/core/map.ts:137-172`, and `src/core/capture.ts:112-163` release after each browser-backed scrape/map/screenshot/PDF.

Implication: cookies, local/session storage, BPC `chrome.storage.local` mutations, optional permission changes, consent banners, meter counters, and anti-bot warm-up state created during a request are discarded at request end. They do not accumulate across requests unless they are present in the template profile before the request starts or the system explicitly promotes runtime changes back to a persistent base.

The current template is more persistent than the per-request runtime, but only in a narrow way:

- With `browser.resetOnStart=false` (default), the template survives service restarts once created.
- With `browser.resetOnStart=true`, the template is wiped/recreated on service startup.
- In neither case does normal per-request runtime state automatically flow back into the template.

So the short answer is: **yes, the per-request runtime profile wipes BPC/browser state per request; the template can preserve only state that was seeded or manually prepared before cloning.**

### 2. NYT/WSJ do not need optional host-permission grants, but they do lose cookies

The bundled BPC manifest declares required host permissions for both NYT and WSJ:

- `bpc-chrome/manifest.json:622` includes `*://*.nytimes.com/*`.
- `bpc-chrome/manifest.json:940` includes `*://*.wsj.com/*`.

The BPC site rules also include both sites as default rules:

- `bpc-chrome/sites.js:3220-3224` NYT: `allow_cookies: 1`, NYT-specific block regex, custom Google Inspection Tool UA.
- `bpc-chrome/sites.js:3351-3355` WSJ: `allow_cookies: 1`, Drudge referer, DOMPurify.

Because these are default host permissions, "BPC never accumulates site grants" is probably **not** the main NYT/WSJ issue. Optional host permissions matter more for custom/updated sites outside required manifest permissions; BPC checks/request paths appear in `options/optin/opt-in.js`, `options/options_custom.js`, and `background.js:1805-1814`.

Cookies are different. BPC intentionally allows cookies for NYT/WSJ, but the request runtime profile is deleted after each request. That means NYT/WSJ cookie state cannot accumulate across requests in the current Docker/Patchright path unless it is baked into the template profile.

### 3. Docker runtime is already using the standard extension-compatible shape

The Docker path uses:

- `docker-compose.yml:15-17`: headed mode by default plus native controls wired but disabled.
- `docker-compose.yml:20-22`: `shm_size: 2gb` and `seccomp:unconfined`.
- `Dockerfile:50-51`: installs Patchright Chromium.
- `Dockerfile:64-67`: leaves `SHUVCRAWL_BROWSER_EXECUTABLE` unset so Patchright uses its patched Chromium, not system Chromium.
- `entrypoint.sh:2-6`: runs headed Chromium under Xvfb (`DISPLAY=:99`).

This is broadly the right shape for MV3 extensions in automation: Playwright documents that Chrome extensions require Chromium launched with a persistent context and extension flags; `launchPersistentContext(userDataDir, ...)` stores cookies/local storage in `userDataDir`. Playwright also warns that automating the default Chrome user profile is not supported; use a separate automation profile instead.

### 4. The current native path is not yet a cookie/BPC replacement

Current native implementation:

- `src/native-browser-server.ts` starts `chromium.launchServer()` with extension flags.
- `src/core/native-browser.ts` connects with `chromium.connect()` and then calls `browser.newContext()` per request.
- It returns `extensionId: 'native'`, `profileDir: 'native'`, and does not wait for a BPC service worker or seed BPC storage.
- Release closes only the new context, not the shared browser.

This is probably not equivalent to the Docker `launchPersistentContext(userDataDir, --load-extension=...)` path. Playwright's Chrome extension guidance says extensions only work in Chromium when launched with a persistent context. A `browser.newContext()` created after connecting to a launch server is not the persistent extension profile model, and it has isolated cookie storage per context. Therefore the current native mode may improve OS/GPU/network fingerprinting, but it likely does **not** provide BPC service-worker readiness, BPC storage seeding, or persistent cookies as currently written.

Native is still worth experimenting with, but only after defining which variant is under test:

- **Current native launchServer/newContext**: test as a fingerprint-only experiment; expect no durable cookies and verify whether BPC is actually active.
- **Host-side persistent Patchright/Chromium automation profile**: closer to the Docker BPC path, but outside Docker; likely the meaningful experiment for cookies + native fingerprint.
- **User's personal Chrome profile**: do not use. It risks session leakage, is explicitly outside this review's boundary, and Playwright warns against automating the default Chrome user profile. Also, official Google Chrome / Edge have removed side-load extension flags needed by this BPC loading pattern, so bundled Chromium/Patchright is the safer path.

## Would a persistent template profile help NYT/WSJ?

Likely yes for any behavior that depends on stable browser state:

- consent cookies,
- regionalization cookies,
- meter/session cookies,
- login/subscriber cookies if intentionally provided,
- warmed anti-bot state,
- pre-granted BPC optional permissions for non-default/custom sites.

For NYT/WSJ specifically, the BPC extension already has required host permissions and default site rules, so the highest-probability benefit is **cookies/session/warm profile**, not optional BPC grants.

Best path: maintain a separate, dedicated automation template profile (not the user's personal Chrome profile), then clone it per request as today. This keeps deterministic per-request isolation while carrying known-good baseline cookies/settings.

A second option is a small pool of persistent runtime profiles rather than delete-on-release. That would allow cookies to evolve, but it increases cross-request/session bleed and makes concurrency harder.

## Experiment design

No public-site scrape was run for this note. Proposed controlled experiment:

### Matrix

For a fixed NYT article URL and a fixed WSJ article URL, run each cell with `noFastPath=true`, `noCache=true`, same wait strategy, same viewport, same IP/network, and artifacts enabled:

1. **Docker current clean template**
   - `native.enabled=false`
   - current template/runtime model
   - request runtime deleted on release

2. **Docker persistent prepared template**
   - create/prepare a dedicated automation template profile
   - visit NYT/WSJ manually or via an approved setup step to establish consent/session cookies
   - restart shuvcrawl with `resetOnStart=false`
   - verify request runtime copies include cookies before navigation

3. **Docker persistent runtime pool (optional)**
   - single domain-scoped runtime profile retained across requests
   - no delete-on-release for the test profile
   - compare request 1 vs request N behavior

4. **Native current launchServer/newContext**
   - `native.enabled=true`
   - verify whether BPC service worker exists in the connected context before counting results
   - if no BPC worker/content-script effect, mark this cell fingerprint-only/not comparable

5. **Native persistent automation profile (candidate implementation)**
   - host-side Patchright/Chromium `launchPersistentContext` using a dedicated automation `userDataDir`
   - BPC extension flags, readiness check, BPC seed, profile reuse or template clone
   - no personal Chrome profile

### Measurements

Collect for each run:

- final URL and HTTP/nav status if available,
- title,
- extracted word count and extraction confidence,
- blocker/paywall DOM signatures,
- screenshot,
- raw HTML artifact,
- BPC service-worker presence and extension ID,
- BPC storage snapshot keys (`sites`, `sites_excluded`, `sites_updated`, `optIn`, `customOptIn`, `optInUpdate`),
- cookie inventory summary for target eTLD+1 before/after navigation (names only or redacted names/metadata, never values),
- elapsed browser acquire time and page navigation time.

### Success criteria

A profile/cookie path is worth keeping only if it improves article extraction quality over the current Docker clean-template baseline without introducing unacceptable leakage:

- higher extracted word count/content completeness,
- fewer blocker/paywall overlays in artifacts,
- stable across at least 3 repeated runs per site,
- no dependence on the user's personal browsing profile,
- clear domain scoping and cleanup story.

## Risks

- **Session leakage:** a persistent or templated profile can carry subscriber cookies, identity cookies, consent state, and anti-bot identifiers into unrelated jobs.
- **Cross-site bleed:** one shared runtime profile can let site A influence site B via cookies/storage/fingerprinting state.
- **Credential exposure in artifacts/logs:** cookie values must never be logged; raw HTML/screenshots can reveal account state.
- **Permission drift:** optional host permissions granted during one experiment may silently change later behavior if stored in the template.
- **Non-determinism:** warm profiles improve some targets but reduce reproducibility.
- **Unsupported personal profile automation:** attaching to the user's regular Chrome profile is unsafe and not supported by Playwright's current guidance.

## Recommendation

1. Treat the current Docker/Patchright path as a clean, deterministic baseline.
2. Add/try a **dedicated automation template profile** for NYT/WSJ before investing in current native mode.
3. If native is tested, first prove BPC is actually active in native mode; current `launchServer()` + `browser.newContext()` is unlikely to be equivalent to the persistent-context extension path.
4. Do not attach to or copy the user's personal Chrome profile. Use a separate profile with explicit site/session scope and redacted artifact handling.
