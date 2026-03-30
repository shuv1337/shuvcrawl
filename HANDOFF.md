# HANDOFF

## Objective
- Maintain the new Docker-first API QA workflow, bundled Pi skill, and visual report flow for `shuvcrawl`.

## Current status
- Implemented end-to-end Docker API harness:
  - `scripts/test-api-docker.sh`
  - `scripts/run-api-suite.ts`
  - `docker-compose.test.yml`
  - deterministic fixtures under `tests/fixtures/`
  - black-box API tests under `tests/api/`
  - bundled skill under `skills/shuvcrawl/`
- Removed obsolete `version:` lines from `docker-compose.yml` and `docker-compose.test.yml`.
- Updated docs/config: `README.md`, `AGENTS.md`, `package.json`, `bunfig.toml`, `.gitignore`, `.dockerignore`.
- Runtime fixes included:
  - malformed JSON now maps to `INVALID_REQUEST` in `src/errors/classify.ts`
  - `BrowserPool` acquisition is serialized in `src/core/browser.ts` to avoid profile races
  - telemetry exporter flush behavior improved in `src/utils/telemetry.ts`

## Key context
- Pi skill discovery should rely on conventional `skills/`; `package.json` metadata is optional shipping clarity only.
- Docker API harness isolates each run under `test-results/<run-id>/runtime/`.
- OTLP verification is feature-flagged via `--verify-otlp` and now passes against the fixture receiver.
- One known non-blocking cleanup item remains: compose emits warnings if `version:` is present; this has now been removed.

## Important files
- `scripts/test-api-docker.sh` — top-level harness entrypoint
- `scripts/run-api-suite.ts` — runs tests, aggregates JSON, writes `report.html`
- `scripts/lib/api-test-recorder.ts` — event/test schemas and manifest generation
- `tests/api/*` — live API black-box coverage
- `tests/fixtures/server.ts` — fixture server + fake OTLP capture endpoint
- `skills/shuvcrawl/SKILL.md` — bundled agent skill
- `README.md` — user-facing docs for harness + skill
- `AGENTS.md` — updated project guidance

## Next steps
1. Create atomic commits for the implemented work and push if requested.
2. Optionally remove or ignore old generated `test-results/` runs before packaging/review.
3. If desired, run `bun run test:api -- --open-report` or regenerate a fresh verification run before release.

## Validation
- `bun run typecheck` ✅
- `bun test tests/unit/api-errors.test.ts tests/unit/auth-middleware.test.ts tests/unit/routes-map-crawl.test.ts` ✅
- `./scripts/test-api-docker.sh --no-build` ✅
- `./scripts/test-api-docker.sh --no-build --verify-otlp` ✅
- Latest successful report:
  - `test-results/api-docker-20260330T085437Z-7b425ee9/report.html`

## Risks / open questions
- `AGENTS.md` is currently untracked in git in this repo state; decide whether to commit it here.
- `PLAN-api-docker-test-report-and-agent-skill.md` is also untracked; likely should be committed as part of the work if the repo wants plans checked in.
- Current git state also includes generated `test-results/`; these should stay untracked.

## Resume prompt
- Review `git status`, commit the harness/report/skill/docs changes as a small atomic series, and include the compose cleanup + HANDOFF refresh in the final docs/chore commit.
