# Patchright + BPC spike

Minimal Bun/TypeScript spike harness for validating Patchright + the unpacked `bpc-chrome/` extension in a persistent Chromium context.

## What it does

- launches Patchright against a persistent profile
- loads the unpacked `bpc-chrome/` extension
- waits for the MV3 service worker
- snapshots and mutates selected `chrome.storage.local` keys
- exercises template-profile -> runtime-profile copy/reset
- gates first navigation on extension readiness + health
- writes JSONL logs, JSON artifacts, screenshots, and a markdown report

## Commands

```bash
# install deps
cd spikes/patchright-bpc
bun install

# default local run
bun run spike:patchright-bpc

# initialize template only
bun run spike:patchright-bpc --init-template

# reset runtime profile from template
bun run spike:patchright-bpc --reset-runtime

# targeted scenario modes
bun run spike:patchright-bpc --scenario launch
bun run spike:patchright-bpc --scenario storage
bun run spike:patchright-bpc --scenario docker-headless
bun run spike:patchright-bpc --scenario docker-headed

# headed local run
bun run spike:patchright-bpc --headed
```

## Useful environment variables

- `BPC_PATH`
- `SPIKE_TARGET_URL`
- `SPIKE_BROWSER_EXECUTABLE`
- `SPIKE_OUTPUT_DIR`
- `SPIKE_HEADLESS=1|0`
- `SPIKE_TIMEOUT_BROWSER_MS`
- `SPIKE_TIMEOUT_WORKER_MS`
- `SPIKE_TIMEOUT_NAVIGATION_MS`
- `SPIKE_TIMEOUT_HEALTH_MS`
- `SPIKE_KEEP_RUNTIME=1`
- `SPIKE_FORCE_TEMPLATE_INIT=1`

## Output

Artifacts are written under:

- `spikes/patchright-bpc/output/logs/`
- `spikes/patchright-bpc/output/artifacts/`
- `spikes/patchright-bpc/output/reports/`
- `spikes/patchright-bpc/output/profiles/`

## Notes

- The harness prefers `SPIKE_BROWSER_EXECUTABLE` when set.
- If unset, it attempts to use a detected system Chromium executable.
- Docker support lives under `spikes/patchright-bpc/docker/` and `spikes/patchright-bpc/scripts/run-docker.sh`.
