# BPC opt-in and site rules (2026-09-18)

Scope: bundled `bpc-chrome` only. No live scrapes and no config edits.

## Current shuvcrawl seeding

`src/core/bpc.ts` maps shuvcrawl BPC config to Chrome extension storage as follows:

- `mode: "aggressive"` is the only shuvcrawl setting that sets BPC `optIn: true`; conservative sets `optIn: false` (`src/core/bpc.ts:15-23`).
- `enableCustomSites` only seeds `customOptIn` (`src/core/bpc.ts:18-22`).
- `enableUpdatedSites` seeds `optInUpdate` (`src/core/bpc.ts:18-22`).
- `storageOverrides` currently only flow into `sites_updated` and `sites_custom`; they do not override top-level `optIn`, `sites`, or permissions (`src/core/bpc.ts:21-22`).
- The browser writes this storage payload into the extension service worker and reads back only `sites_excluded`, `optIn`, `customOptIn`, and `optInUpdate` for logging (`src/core/browser.ts:263-283`).

The extension manifest confirms this is Manifest V3 Bypass Paywalls Clean v4.4.4.5 with default host permissions for `nytimes.com`, `theatlantic.com`, `washingtonpost.com`, and `wsj.com` (`bpc-chrome/manifest.json:16-20`, `bpc-chrome/manifest.json:622`, `bpc-chrome/manifest.json:810`, `bpc-chrome/manifest.json:916`, `bpc-chrome/manifest.json:940`, `bpc-chrome/manifest.json:1010`).

## How default, updated, and custom rules are loaded

On install, BPC writes a `sites` map containing every default site whose domain is not `###` and not `#options_disable_*` or `#options_optin_*` (`bpc-chrome/background.js:219-229`). Because `#options_enable_new_sites` does not match `#options_optin_*`, it is part of the shipped default `sites` set (`bpc-chrome/sites.js:5-13`; `bpc-chrome/background.js:221-226`).

At startup, BPC reads `sites`, `sites_updated`, `sites_custom`, `sites_excluded`, and opt-in flags from local storage (`bpc-chrome/background.js:951-979`). Enabled sites are computed from the stored `sites` values, intersected with default, custom, and updated-site domains (`bpc-chrome/background.js:981-985`). `set_rules()` then resolves each enabled site in this order: default rule, matching updated rule override, new updated rule, new custom rule (`bpc-chrome/background.js:794-821`). If an updated rule exists for the same site title, it replaces the default rule (`bpc-chrome/background.js:804-810`).

BPC checks `sites_updated.json` on startup and stores fetched update rules in `sites_updated` (`bpc-chrome/background.js:232-244`, `bpc-chrome/background.js:1044-1049`). In this bundled copy, the local `sites_updated.json` has no entries for `nytimes.com`, `wsj.com`, `washingtonpost.com`, or `theatlantic.com` (`bpc-chrome/sites_updated.json:1-79`). Online update-rule fetching is only selected when the stored `sites` includes `#options_optin_update_rules` and the extension is self-hosted (`bpc-chrome/background.js:1040-1043`); BPC's install defaults exclude that option (`bpc-chrome/background.js:221-226`).

Custom-site UI opt-in is a permissions flow: it requests `*://*/*` optional host permissions and sets `customOptIn` only after grant (`bpc-chrome/options/optin/opt-in.js:42-70`). The background path that actually builds rules consumes `sites_custom`, not `customOptIn` (`bpc-chrome/background.js:951-979`, `bpc-chrome/background.js:1093-1125`). Therefore, in shuvcrawl today, `enableCustomSites: true` by itself is mostly a UI/storage marker; useful custom behavior also requires `sites_custom` entries and the needed host permission coverage.

## Default rules for NYT / WSJ / WaPo / The Atlantic

The target domains are default sites, not custom or updated sites:

- `nytimes.com`: `allow_cookies: 1`; blocks NYT meter / onsite messaging / MWCM / Cooking access URLs; sets a custom `User-Agent` of `Mozilla/5.0 (compatible; Google-InspectionTool/1.0)` (`bpc-chrome/sites.js:3220-3224`).
- `wsj.com`: `allow_cookies: 1`; sets custom `Referer: https://www.drudgereport.com/`; enables DOMPurify content-script support (`bpc-chrome/sites.js:3351-3355`).
- `washingtonpost.com`: `allow_cookies: 1`; blocks `tetro-client`; uses Googlebot headers (`bpc-chrome/sites.js:3357-3362`).
- `theatlantic.com`: `allow_cookies: 1`; blocks The Atlantic Zephr URLs (`bpc-chrome/sites.js:2945-2949`).

For Chromium MV3, BPC creates a header-modification rule only when a rule needs cookie clearing or header/user-agent/referer changes (`bpc-chrome/background.js:416-441`). Crucially, the `Cookie` request header is cleared only when the domain is not in `allow_cookies` (`bpc-chrome/background.js:435-441`). `addRules()` puts a domain in `allow_cookies` when the rule has `allow_cookies > 0`, and only puts a domain in `remove_cookies` when the rule has `remove_cookies > 0` or selective cookie-removal fields (`bpc-chrome/background.js:606-620`). Runtime cookie deletion after page load only runs for enabled domains in `remove_cookies` (`bpc-chrome/background.js:1303-1307`, `bpc-chrome/background.js:1432-1435`, `bpc-chrome/background.js:1950-1997`).

Because all four target rules have `allow_cookies: 1` and none has `remove_cookies` or selective cookie-removal fields, conservative BPC is not expected to rewrite or delete NYT/WSJ/WaPo/Atlantic cookies. It can still block listed paywall scripts and rewrite non-cookie headers for rules that ask for them: NYT user-agent, WSJ referer, WaPo Googlebot headers.

## What conservative vs aggressive changes here

In shuvcrawl, conservative vs aggressive currently changes only `optIn` (`src/core/bpc.ts:15-23`). In this bundled BPC version, `optIn` is read into `optin_setcookie` (`bpc-chrome/background.js:951-979`) and updated on storage changes (`bpc-chrome/background.js:1171-1173`). But its live uses appear inert for the target domains:

- Inline-script bypass has a hard-coded empty domain list: `if (matched && optin_setcookie && [].includes(domain)) matched = false` (`bpc-chrome/background.js:1264-1269`).
- The content-script flag is only sent when the URL matches `['###']`, which real NYT/WSJ/WaPo/Atlantic URLs do not (`bpc-chrome/background.js:1303-1315`).
- The content script's `optin_setcookie` block is currently a no-op (`bpc-chrome/contentScript.js:266-269`).

So flipping `mode` from conservative to aggressive is not expected to change cookie behavior for NYT or WSJ in this bundled extension. It globally changes `optIn` storage state, but this BPC copy does not use that flag for NYT/WSJ cookie clearing or setting.

`enableUpdatedSites: true` keeps `optInUpdate: true`; BPC still loads the bundled `sites_updated.json` on startup either way, while `optInUpdate` mainly controls update checks / update-version handling (`bpc-chrome/background.js:1044-1049`; `bpc-chrome/options/version.js:60-66`). It does not add new target-specific NYT/WSJ rules in the bundled update file.

`enableCustomSites: true` only seeds `customOptIn`; by itself it does not add custom rules or grant optional permissions. `storageOverrides.sites_custom` can add rules, and `storageOverrides.sites_updated` can override default rules by title or add new updated sites (`src/core/bpc.ts:21-22`; `bpc-chrome/background.js:804-821`; `bpc-chrome/background.js:1093-1125`). For the default target domains, a `sites_updated` override matching `The New York Times` or `The Wall Street Journal` would be the narrowest way to alter their BPC rule without changing every site.

## Safest optIn experiment

Do not make `mode: "aggressive"` the service default. The safest test is a disposable browser-profile harness that:

1. Launches bundled BPC with the normal conservative config.
2. Uses the extension service worker to set `chrome.storage.local.set({ optIn: true })` for that one throwaway session only.
3. Reads `chrome.storage.local.get({ optIn: false })` back to prove the flag is set.
4. Verifies behavior against a controlled/local test page or static extension assertions, not a production NYT/WSJ scrape.
5. Destroys the runtime profile after the test.

This tests `optIn` without changing the global shuvcrawl default and without enabling broader custom/updated-site behavior. Based on the source above, the expected result is no NYT/WSJ cookie rewrite change unless the extension code or a targeted rule is also changed.
