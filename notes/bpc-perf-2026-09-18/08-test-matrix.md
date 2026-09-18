# Capture test matrix — complete — 2026-09-18

Metrics only. No article bodies.

## CUA real Chromium

Isolated profile `--user-data-dir=/tmp/cua-bpc-profile` on Hyprland `special:cua`, CDP 9225. Not personal Chrome. Navigate via `location.href`. No challenge clicks.

- NYT: real headline, htmlLen 446565, textLen 3530, no DataDome interstitial
- WSJ: real h1 + `<article>`, htmlLen 878584, textLen 2275, no interstitial
- WaPo: real headline, htmlLen 1107314, textLen 3126, no interstitial

Host Chromium is not DataDome-blocked on these URLs.

## shuvcrawl API (18 rows, `/tmp/bpc_test_matrix.json`)

adapter_now = current Spoken Article payload `{rawHtml, onlyMainContent}`.

- example adapter_now: thin 149, fast-path 0.15s
- example noFastPath: thin 149, bpc-extension 1.86s
- nyt adapter_now: datadome, 0 content, 1.36s, title nytimes.com
- nyt noFastPath: datadome, 0 content, 1.22s
- nyt noFastPath_sleep5: **article 9764 chars, 9.08s, bpc-extension**, real headline
- nyt noBpc_sleep3: **article 9764 chars, 8.08s, direct** (same extract, no BPC)
- wsj adapter_now: robots Disallow / 0.07s
- wsj noFastPath (+noRobots): datadome 0 content 2.44s
- wsj sleep5 / noBpc sleep3: ReadTimeout 90s
- atlantic adapter_now: **article 13632, fast-path 0.23s**
- atlantic any browser variant: **goto Timeout 30s** (load never fires)
- wapo adapter_now: ReadTimeout 90s (fast-path hang)
- wapo noFastPath: **article 4673, 7.0s, bpc-extension**
- wapo sleep5: article 4673, 10.87s, bpc-extension
- wapo noBpc sleep3: **article 4673, 8.83s, direct**

## Ranked conclusions

1. Do not blindly `noFastPath`. Atlantic only works on fast-path. WaPo only works when fast-path is skipped.
2. NYT Docker fail at `wait:load` is an early DataDome snapshot. 3–5s sleep yields the article **with or without BPC**. BPC is not the NYT lever.
3. WSJ Docker stays dead (robots → DataDome → timeout). Real Chromium loads it. Fingerprint/native, not more BPC.
4. WaPo: skip fast-path; BPC optional (direct also 4673 chars).
5. Spoken Article should: try fast-path, on reject/timeout/challenge fall through to browser with `wait:"sleep", sleep:5000`; keep `bypassMethod`; classify DataDome vs article.

## Not done

- Persistent Docker template profile
- VoiceStudio adapter patch (ready to do)
