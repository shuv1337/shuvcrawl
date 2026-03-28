#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MODE="${SPIKE_DOCKER_MODE:-headless}"
IMAGE="patchright-bpc-spike:${MODE}"

cd "$REPO_ROOT"
docker build -f spikes/patchright-bpc/docker/Dockerfile -t "$IMAGE" .
HOST_OUTPUT_DIR="$REPO_ROOT/spikes/patchright-bpc/output/docker-${MODE}"
rm -rf "$HOST_OUTPUT_DIR"
mkdir -p "$HOST_OUTPUT_DIR"
docker run --rm \
  -e SPIKE_SCENARIO="docker-${MODE}" \
  -e SPIKE_HEADLESS="$([ "$MODE" = "headless" ] && echo 1 || echo 0)" \
  -e SPIKE_OUTPUT_DIR="/app/spikes/patchright-bpc/output/docker-${MODE}" \
  -e SPIKE_FORCE_TEMPLATE_INIT=1 \
  -e DISPLAY=:99 \
  -v "$HOST_OUTPUT_DIR:/app/spikes/patchright-bpc/output/docker-${MODE}" \
  "$IMAGE"
