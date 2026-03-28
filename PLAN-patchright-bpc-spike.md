# PLAN-patchright-bpc-spike

## Objective

Validate the core technical assumption behind `shuvcrawl-spec.md`: that shuvcrawl can reliably run **Patchright + the unpacked `bpc-chrome/` extension** in a persistent Chromium context, wait for BPC readiness, seed/reconcile extension state, and only then navigate/render pages.

This plan is for a **concrete spike**, not full product implementation.

## Why this spike exists

The spec currently depends on several browser-layer assumptions that are plausible but not yet proven in this repo:

- Patchright can launch Chromium with the unpacked BPC extension loaded.
- The BPC **Manifest V3 service worker** can be detected and waited on deterministically.
- BPC storage can be seeded/reconciled programmatically in a repeatable way.
- A **template profile → runtime profile** model is workable in local dev and Docker.
- Headless Chromium with extensions is viable enough for V1, or we can clearly prove that the official Docker path should use **headed Chromium under Xvfb** instead.

The spike should answer those questions with evidence, logs, and a go/no-go recommendation.

---

## Scope

### In scope

- Minimal Bun/TypeScript spike harness for Patchright + BPC loading
- Persistent Chromium context launch with:
  - `--disable-extensions-except={bpcPath}`
  - `--load-extension={bpcPath}`
- Detection of the BPC MV3 service worker
- Storage read/write validation for core BPC keys
- Template/runtime profile copy/reset workflow
- Local and Docker validation
- Minimal telemetry/logging for the spike itself
- A small evidence report capturing results and blockers

### Out of scope

- Full shuvcrawl CLI/API implementation
- Full scraper pipeline
- Crawl orchestration
- LLM extraction
- Complete BPC adapter implementation for all config modes
- Production-hardening, retries, or broad cross-site support

---

## Questions this spike must answer

1. Can Patchright launch Chromium with the unpacked `bpc-chrome/` extension in this repo?
2. Can the spike deterministically detect when the BPC MV3 service worker is ready?
3. Can the spike programmatically inspect and mutate BPC storage keys such as:
   - `sites`
   - `sites_excluded`
   - `sites_custom`
   - `sites_updated`
   - `optIn`
   - `customOptIn`
   - `optInUpdate`
4. Does a **template profile** containing extension install state survive copying into a **runtime profile** without unexpected breakage?
5. Is headless mode sufficient, or is the shuvcrawl Docker baseline better defined as **headed + virtual display**?
6. Can we produce enough observability to make BPC initialization failures diagnosable?

---

## Relevant repo references

### Primary spec

- `shuvcrawl-spec.md`
  - BPC integration: sections 3.1–3.8
  - Browser/render pipeline: sections 4.1–4.9
  - Docker/runtime notes: section 11
  - Testing strategy: section 14
  - V1 milestones: section 16
  - Open questions: section 17

### Browser candidates / evidence

- `browsers/patchright/README.md`
- `browsers/patchright/patchright.patch`
- `browsers/patchright/driver_patches/chromiumSwitchesPatch.ts`

### BPC source under test

- `bpc-chrome/manifest.json`
- `bpc-chrome/background.js`
- `bpc-chrome/sites.js`
- `bpc-chrome/sites_updated.json`
- `bpc-chrome/options/options.js`
- `bpc-chrome/options/options_custom.js`
- `bpc-chrome/options/options_excluded.js`

### Comparison / fallback references

- `browsers/CloakBrowser/README.md`
- `camoufox/README.md`
- `browsers/rayobrowse/README.md`

---

## External references

These are the main external code/docs references to consult during the spike:

- Patchright repo: `https://github.com/Kaliiiiiiiiii-Vinyzu/patchright`
- Patchright Node package: `https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs`
- Playwright persistent context docs: `https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context`
- Playwright Chrome extensions guide: `https://playwright.dev/docs/chrome-extensions`
- BPC Chromium fork homepage from manifest: `https://github.com/nicehash/bypass-paywalls-chrome-clean`
- Chrome extension storage docs: `https://developer.chrome.com/docs/extensions/reference/api/storage`
- Chrome MV3 service worker lifecycle docs: `https://developer.chrome.com/docs/extensions/develop/concepts/service-workers`

---

## Proposed spike deliverables

- [x] A runnable spike harness under a dedicated spike directory
- [x] Structured logs showing each stage of BPC bootstrap
- [x] A profile workflow that proves template/runtime copy/reset behavior
- [x] A Docker validation path with clear result: `headless-ok` or `headed-xvfb-required`
- [x] A short evidence report summarizing findings, failures, and recommendation

---

## Proposed file layout for the spike

These files are **proposed outputs** of the spike, not currently present:

```text
spikes/
  patchright-bpc/
    package.json
    bunfig.toml
    tsconfig.json
    README.md
    src/
      index.ts
      config.ts
      logger.ts
      telemetry.ts
      paths.ts
      profile.ts
      launch.ts
      extension.ts
      storage.ts
      health.ts
      scenario.ts
      artifacts.ts
    scripts/
      run-local.sh
      run-docker.sh
      reset-profiles.sh
    docker/
      Dockerfile
      docker-compose.yml
    output/
      logs/
      artifacts/
      reports/
```

If you want the spike to live in the eventual main app skeleton instead, use:

```text
src/spikes/patchright-bpc/
```

But a top-level `spikes/` directory is cleaner for a disposable validation effort.

---

## Required spike scenarios

### Scenario A — Local launch + extension detection

Goal: prove Patchright can launch Chromium with the unpacked extension and detect the BPC service worker.

Success criteria:

- Browser launches successfully
- Persistent context is created
- Extension service worker is discovered within timeout
- Extension ID / service worker URL is recorded in logs

### Scenario B — Storage seeding + readback

Goal: prove the spike can programmatically set and verify BPC storage state.

Success criteria:

- Read current storage snapshot
- Write a controlled test payload to relevant keys
- Read values back and confirm exact match
- Log full before/after diff for the test keys

### Scenario C — Template profile bootstrap

Goal: prove a template profile can be built once and copied to a runtime profile.

Success criteria:

- Template profile contains installed extension state
- Runtime profile copied from template launches correctly
- Runtime reset from template is deterministic
- No corruption or stale lockfiles prevent reuse

### Scenario D — First navigation only after readiness

Goal: prove the spike can enforce the startup contract from the spec.

Success criteria:

- Navigation is blocked until extension readiness passes
- Logs show ordered phases:
  1. resolve BPC path
  2. launch persistent context
  3. detect service worker
  4. seed/reconcile storage
  5. run health check
  6. navigate target URL

### Scenario E — Docker runtime validation

Goal: determine the correct browser execution mode for V1.

Success criteria:

- Local Docker image builds successfully
- Browser launches with extension under at least one supported runtime mode
- Evidence clearly identifies one of:
  - `headless-new viable`
  - `headless flaky, headed+xvfb required`
  - `both viable`

---

## Implementation phases

## Phase 1 — Create minimal spike harness

- [x] Create the spike workspace (`spikes/patchright-bpc/`)
- [x] Add Bun package manifest and TS config
- [x] Add a simple entrypoint (`src/index.ts`) that orchestrates the spike phases
- [x] Add a minimal config layer for:
  - [x] BPC path
  - [x] profile root
  - [x] template profile path
  - [x] runtime profile path
  - [x] timeouts
  - [x] output/artifact directories
  - [x] target URL for readiness smoke test
- [x] Add structured logger utility with JSON line output
- [x] Add simple timing/span helpers for stage durations

### Validation

- [x] `bun run` starts and prints a structured `spike.start` event
- [x] Config resolves correctly on a clean machine
- [x] Output directories are created predictably

---

## Phase 2 — Browser launch with extension flags

- [x] Install and wire Patchright in the spike package
- [x] Implement `launch.ts` that:
  - [x] resolves BPC path from repo (`./bpc-chrome`)
  - [x] creates/uses persistent `userDataDir`
  - [x] launches Chromium with:
    - [x] `--disable-extensions-except={bpcPath}`
    - [x] `--load-extension={bpcPath}`
  - [x] records executable/browser version info
  - [x] captures launch args in logs
- [x] Add explicit timeout and failure classification for browser init failures

### Validation

- [x] Browser launch works locally
- [x] Failures include actionable error details in logs
- [x] The spike can open a blank page after launch

---

## Phase 3 — MV3 service worker readiness detection

- [x] Implement `extension.ts` readiness logic that waits for the BPC service worker
- [x] Capture and log:
  - [x] extension ID
  - [x] service worker URL
  - [x] time-to-worker-ready
- [x] If the worker is not present immediately, poll/wait until timeout
- [x] Persist failure artifacts when readiness times out

### Notes

The readiness logic should not rely on “sleep and hope.” It should use a concrete observable signal from the browser context / worker list / CDP state.

### Validation

- [x] Worker appears on a fresh profile
- [x] Worker appears on a copied runtime profile
- [x] Timeout path is deterministic and produces artifacts/logs

---

## Phase 4 — BPC storage inspection and mutation

- [x] Implement `storage.ts` to inspect BPC storage via browser context automation
- [x] Add a storage snapshot step for relevant keys:
  - [x] `sites`
  - [x] `sites_excluded`
  - [x] `sites_custom`
  - [x] `sites_updated`
  - [x] `optIn`
  - [x] `customOptIn`
  - [x] `optInUpdate`
- [x] Add a controlled write/readback scenario using a test configuration
- [x] Store before/after snapshots as JSON artifacts

### Validation

- [x] All target keys can be observed or explicitly classified as unavailable
- [x] At least one controlled mutation survives round-trip verification
- [x] Logs explain any keys that behave unexpectedly

---

## Phase 5 — Template profile → runtime profile workflow

- [x] Implement `profile.ts` with helpers for:
  - [x] initialize template profile
  - [x] copy template → runtime
  - [x] reset runtime profile from template
  - [x] clean lock/temp files safely
- [x] Decide and document whether copying uses:
  - [x] filesystem copy
  - [ ] rsync-like copy preserving attributes
  - [ ] archive/unpack approach
- [x] Record profile sizes and copy durations in logs

### Validation

- [x] Template profile can be created once and reused
- [x] Runtime reset works repeatedly across multiple runs
- [x] Extension readiness still passes after profile copy/reset

---

## Phase 6 — Health check and gated navigation

- [x] Implement `health.ts` that performs a minimal BPC health check after storage reconciliation and before first navigation
- [x] Define a health contract such as:
  - [x] service worker present
  - [x] storage keys readable
  - [x] core config keys in expected state
- [x] Implement `scenario.ts` to navigate only after health passes
- [x] Add a smoke target strategy:
  - [x] one inert page like `https://example.com/`
  - [ ] one optional real-world target for manual observation

### Validation

- [x] Navigation never begins before health check success
- [x] Ordered lifecycle events appear in logs exactly as specified
- [x] Health check failures stop navigation with a clear result code

---

## Phase 7 — Docker validation

- [x] Create a spike Dockerfile that installs Bun, Patchright deps, and Chromium runtime dependencies
- [x] Add Docker Compose for local execution
- [x] Validate both:
  - [x] headless mode
  - [x] headed mode under Xvfb / virtual display
- [x] Capture artifacts for both modes:
  - [x] logs
  - [x] screenshot of loaded page (if navigation succeeds)
  - [x] extension readiness timings

### Validation

- [x] At least one Docker runtime mode passes all earlier scenarios
- [x] Final report explicitly recommends Docker baseline mode for shuvcrawl V1

---

## Phase 8 — Evidence report and recommendation

- [x] Write `output/reports/patchright-bpc-spike-report.md`
- [x] Include:
  - [x] environment used
  - [x] local results
  - [x] Docker results
  - [x] readiness timings
  - [x] storage behavior summary
  - [x] profile workflow behavior summary
  - [x] unresolved blockers
  - [x] recommended next step
- [x] Summarize one of:
  - [x] proceed with Patchright as spec’d
  - [ ] proceed, but require headed/Xvfb in Docker
  - [ ] use alternate browser backend for V1

### Validation

- [x] Report is reproducible from saved artifacts/logs
- [x] Recommendation is evidence-backed, not intuition-based

---

## Telemetry and logging requirements for the spike

The repo-level agent instructions require telemetry-first engineering. Even though this is a spike, it should still produce useful observability.

### Minimum spike telemetry contract

- [x] Structured JSON logs for each lifecycle stage
- [x] Stable correlation IDs:
  - [x] `runId`
  - [x] `profileId`
  - [x] `scenarioId`
- [x] Stage timings for:
  - [x] launch
  - [x] worker detection
  - [x] storage seed
  - [x] health check
  - [x] navigation
- [x] Explicit failure events with error class / cause
- [ ] Optional OTLP stub wiring only if cheap; otherwise local structured logs are sufficient for the spike

### Suggested event names

```text
spike.start
bpc.path.resolved
browser.launch.start
browser.launch.success
browser.launch.failed
extension.worker.wait.start
extension.worker.ready
extension.worker.timeout
bpc.storage.snapshot
bpc.storage.write.start
bpc.storage.write.success
bpc.healthcheck.pass
bpc.healthcheck.fail
navigation.start
navigation.success
navigation.fail
profile.template.created
profile.runtime.copied
profile.runtime.reset
spike.complete
```

---

## Suggested commands

These are target commands for the spike harness once created:

```bash
# Local
bun run spike:patchright-bpc

# Fresh template bootstrap
bun run spike:patchright-bpc --init-template

# Reset runtime profile from template
bun run spike:patchright-bpc --reset-runtime

# Docker
./spikes/patchright-bpc/scripts/run-docker.sh
```

Optional targeted modes:

```bash
bun run spike:patchright-bpc --scenario launch
bun run spike:patchright-bpc --scenario storage
bun run spike:patchright-bpc --scenario docker-headless
bun run spike:patchright-bpc --scenario docker-headed
```

---

## Acceptance criteria

The spike is successful if all of the following are true:

- [x] Patchright launches a persistent Chromium context with unpacked `bpc-chrome`
- [x] BPC MV3 service worker readiness can be detected deterministically
- [x] Core BPC storage keys can be read, and at least one controlled write/readback succeeds
- [x] Template/runtime profile lifecycle is repeatable
- [x] Docker has one clearly viable baseline mode
- [x] The spike produces enough telemetry/logging to diagnose failures
- [x] The final report makes a clear go/no-go recommendation for Patchright as the shuvcrawl V1 backend

---

## Failure criteria / decision triggers

Escalate to a fallback browser evaluation (likely CloakBrowser) if any of these remain unresolved after the spike:

- [ ] Extension worker readiness cannot be observed reliably
- [ ] BPC storage reconciliation is flaky or inaccessible
- [ ] Profile copy/reset corrupts extension state repeatedly
- [ ] Docker cannot support a stable browser mode with BPC loaded
- [ ] Patchright browser initialization is too brittle to support a local-first open-source tool

---

## Follow-up plan if the spike succeeds

If the spike passes, the next implementation plan should convert the spike into product code by building:

- [ ] `BrowserPool` abstraction
- [ ] `BpcAdapter` with config mapping
- [ ] browser profile manager under `~/.shuvcrawl/browser/`
- [ ] scrape pipeline integration
- [ ] config schema + CLI/API exposure
- [ ] full tests and telemetry wiring in the main app

---

## Recommended execution order

1. Phase 1 — harness scaffold
2. Phase 2 — browser launch
3. Phase 3 — worker readiness
4. Phase 4 — storage validation
5. Phase 5 — profile lifecycle
6. Phase 6 — gated navigation
7. Phase 7 — Docker validation
8. Phase 8 — report and recommendation

This order minimizes wasted work: if Phases 2–4 fail badly, the team should stop before building broader scaffolding.
