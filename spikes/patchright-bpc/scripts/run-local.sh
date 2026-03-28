#!/usr/bin/env bash
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$SPIKE_DIR"
bun install
bun run spike:patchright-bpc "$@"
