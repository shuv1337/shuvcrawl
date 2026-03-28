#!/usr/bin/env bash
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rm -rf "$SPIKE_DIR/output/profiles/runtime" \
       "$SPIKE_DIR/output/profiles/template"
mkdir -p "$SPIKE_DIR/output/profiles"
echo "Reset spike profiles under $SPIKE_DIR/output/profiles"
