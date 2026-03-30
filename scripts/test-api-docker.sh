#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NO_BUILD=false
OPEN_REPORT=false
VERIFY_OTLP=false

for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=true ;;
    --open-report) OPEN_REPORT=true ;;
    --verify-otlp) VERIFY_OTLP=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

RUN_ID="api-docker-$(date -u +%Y%m%dT%H%M%SZ)-$(python3 - <<'PY'
import uuid
print(str(uuid.uuid4())[:8])
PY
)"
RUN_DIR="$ROOT_DIR/test-results/$RUN_ID"
RUNTIME_DIR="$RUN_DIR/runtime"
DOCKER_DIR="$RUN_DIR/docker"
API_DIR="$RUN_DIR/api"
ARTIFACT_DIR="$RUN_DIR/artifacts"
COMPOSE_PROJECT="$(printf 'shuvcrawl-api-test-%s' "$RUN_ID" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-_')"
API_TOKEN="test-token-${RUN_ID}"
CONTAINER_RUNTIME_DIR="/app/test-runtime"
FIXTURE_PORT=4444
API_PORT=3777

mkdir -p "$RUN_DIR" "$RUNTIME_DIR" "$DOCKER_DIR" "$API_DIR" "$ARTIFACT_DIR"
mkdir -p "$RUNTIME_DIR/output" "$RUNTIME_DIR/artifacts" "$RUNTIME_DIR/cache" "$RUNTIME_DIR/browser/template" "$RUNTIME_DIR/browser/runtime" "$RUNTIME_DIR/data" "$RUNTIME_DIR/telemetry"

cleanup() {
  set +e
  docker compose -p "$COMPOSE_PROJECT" -f docker-compose.yml -f docker-compose.test.yml logs > "$DOCKER_DIR/compose-logs.txt" 2>&1 || true
  docker compose -p "$COMPOSE_PROJECT" -f docker-compose.yml -f docker-compose.test.yml ps > "$DOCKER_DIR/compose-ps.txt" 2>&1 || true
  docker compose -p "$COMPOSE_PROJECT" -f docker-compose.yml -f docker-compose.test.yml down -v > "$DOCKER_DIR/compose-down.txt" 2>&1 || true
}
trap cleanup EXIT INT TERM

OTLP_ENDPOINT_JSON="null"
if [ "$VERIFY_OTLP" = true ]; then
  OTLP_ENDPOINT_JSON="\"http://fixtures:${FIXTURE_PORT}\""
fi

cat > "$RUNTIME_DIR/config.json" <<JSON
{
  "output": {
    "dir": "${CONTAINER_RUNTIME_DIR}/output",
    "format": "markdown",
    "includeMetadata": true,
    "metaLog": true,
    "writeArtifactsOnFailure": true
  },
  "browser": {
    "headless": true,
    "executablePath": "/usr/bin/chromium",
    "args": ["--disable-gpu", "--disable-dev-shm-usage", "--disable-setuid-sandbox", "--no-sandbox"],
    "defaultTimeout": 15000,
    "viewport": { "width": 1440, "height": 960 },
    "profileRoot": "${CONTAINER_RUNTIME_DIR}/browser",
    "templateProfile": "${CONTAINER_RUNTIME_DIR}/browser/template",
    "runtimeProfile": "${CONTAINER_RUNTIME_DIR}/browser/runtime",
    "resetOnStart": true
  },
  "bpc": {
    "enabled": true,
    "sourceMode": "bundled",
    "path": "./bpc-chrome",
    "source": null,
    "mode": "conservative",
    "enableUpdatedSites": true,
    "enableCustomSites": false,
    "excludeDomains": [],
    "storageOverrides": {}
  },
  "fastPath": {
    "enabled": true,
    "userAgent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "referer": "https://www.google.com/",
    "minContentLength": 20,
    "tls": { "rejectUnauthorized": true, "caBundlePath": null }
  },
  "extraction": {
    "selectorOverrides": {},
    "stripSelectors": ["nav", "footer", "header", ".advertisement", ".ad-container", "[data-ad]", ".social-share", ".related-articles", ".newsletter-signup"],
    "minConfidence": 0.5
  },
  "artifacts": {
    "enabled": true,
    "dir": "${CONTAINER_RUNTIME_DIR}/artifacts",
    "onFailure": true,
    "includeRawHtml": true,
    "includeCleanHtml": true,
    "includeScreenshot": true,
    "includeConsole": true
  },
  "proxy": { "url": null, "rotatePerRequest": false },
  "api": { "port": ${API_PORT}, "host": "0.0.0.0", "token": null, "rateLimit": 0 },
  "cache": { "enabled": true, "ttl": 3600, "dir": "${CONTAINER_RUNTIME_DIR}/cache", "cacheFailures": false, "staleOnError": false },
  "crawl": { "defaultDepth": 3, "defaultLimit": 50, "delay": 0, "respectRobots": true },
  "telemetry": {
    "logs": true,
    "logLevel": "info",
    "otlpHttpEndpoint": ${OTLP_ENDPOINT_JSON},
    "serviceName": "shuvcrawl",
    "exporter": "otlp-http"
  },
  "storage": { "jobDbPath": "${CONTAINER_RUNTIME_DIR}/data/jobs.db" }
}
JSON

cat > "$RUN_DIR/env.json" <<JSON
{
  "runId": "$RUN_ID",
  "composeProject": "$COMPOSE_PROJECT",
  "apiBaseUrl": "http://localhost:${API_PORT}",
  "fixtureExternalBaseUrl": "http://localhost:${FIXTURE_PORT}",
  "fixtureInternalBaseUrl": "http://fixtures:${FIXTURE_PORT}",
  "verifyOtlp": ${VERIFY_OTLP},
  "configPath": "runtime/config.json"
}
JSON

export SHUVCRAWL_TEST_RUN_ID="$RUN_ID"
export SHUVCRAWL_TEST_RUN_DIR="$RUN_DIR"
export SHUVCRAWL_TEST_RUNTIME_DIR="$RUNTIME_DIR"
export SHUVCRAWL_TEST_CONTAINER_RUNTIME_DIR="$CONTAINER_RUNTIME_DIR"
export SHUVCRAWL_TEST_EVENTS_PATH="$API_DIR/events.jsonl"
export SHUVCRAWL_TEST_REQUESTS_PATH="$API_DIR/requests.jsonl"
export SHUVCRAWL_TEST_VERIFY_OTLP="$VERIFY_OTLP"
export SHUVCRAWL_TEST_OPEN_REPORT="$OPEN_REPORT"
export SHUVCRAWL_API_BASE_URL="http://localhost:${API_PORT}"
export SHUVCRAWL_FIXTURE_INTERNAL_BASE_URL="http://fixtures:${FIXTURE_PORT}"
export SHUVCRAWL_FIXTURE_EXTERNAL_BASE_URL="http://localhost:${FIXTURE_PORT}"
export SHUVCRAWL_API_TOKEN="$API_TOKEN"
if [ "$VERIFY_OTLP" = true ]; then
  export SHUVCRAWL_TELEMETRY_OTLPHTTPENDPOINT="http://fixtures:${FIXTURE_PORT}"
  export SHUVCRAWL_TELEMETRY_FLUSH_INTERVAL_MS=250
else
  unset SHUVCRAWL_TELEMETRY_OTLPHTTPENDPOINT || true
  unset SHUVCRAWL_TELEMETRY_FLUSH_INTERVAL_MS || true
fi

BUILD_FLAG="--build"
if [ "$NO_BUILD" = true ]; then
  BUILD_FLAG=""
fi

{
  echo "{"
  echo "  \"ts\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," 
  echo "  \"event\": \"harness.start\"," 
  echo "  \"runId\": \"$RUN_ID\"," 
  echo "  \"composeProject\": \"$COMPOSE_PROJECT\"," 
  echo "  \"noBuild\": $NO_BUILD," 
  echo "  \"verifyOtlp\": $VERIFY_OTLP" 
  echo "}"
} > "$RUN_DIR/harness-log.jsonl"

set -x
docker compose -p "$COMPOSE_PROJECT" -f docker-compose.yml -f docker-compose.test.yml up -d ${BUILD_FLAG}
set +x

docker compose -p "$COMPOSE_PROJECT" -f docker-compose.yml -f docker-compose.test.yml ps > "$DOCKER_DIR/compose-ps-start.txt"
docker compose -p "$COMPOSE_PROJECT" -f docker-compose.yml -f docker-compose.test.yml images > "$DOCKER_DIR/compose-images.txt"
CONTAINER_IDS="$(docker compose -p "$COMPOSE_PROJECT" -f docker-compose.yml -f docker-compose.test.yml ps -q | tr '\n' ' ')"
if [ -n "$CONTAINER_IDS" ]; then
  docker inspect $CONTAINER_IDS > "$DOCKER_DIR/inspect.json"
fi
cat > "$DOCKER_DIR/startup-metadata.json" <<JSON
{
  "runId": "$RUN_ID",
  "composeProject": "$COMPOSE_PROJECT",
  "startedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "containerIds": [$(docker compose -p "$COMPOSE_PROJECT" -f docker-compose.yml -f docker-compose.test.yml ps -q | awk '{printf "%s\"%s\"", sep, $0; sep=","}')],
  "apiBaseUrl": "http://localhost:${API_PORT}",
  "fixtureBaseUrl": "http://localhost:${FIXTURE_PORT}",
  "configPath": "runtime/config.json",
  "verifyOtlp": ${VERIFY_OTLP}
}
JSON

wait_for_health() {
  local name="$1"
  local url="$2"
  local attempts="${3:-60}"
  local sleep_seconds="${4:-2}"
  local auth_header="${5:-}"
  for ((i=1; i<=attempts; i++)); do
    if [ -n "$auth_header" ]; then
      if curl -sf -H "$auth_header" "$url" > /dev/null; then
        echo "$name healthy at $url"
        return 0
      fi
    else
      if curl -sf "$url" > /dev/null; then
        echo "$name healthy at $url"
        return 0
      fi
    fi
    sleep "$sleep_seconds"
  done
  echo "Timed out waiting for $name at $url" >&2
  return 1
}

wait_for_health "fixtures" "http://localhost:${FIXTURE_PORT}/health" 60 2
wait_for_health "shuvcrawl" "http://localhost:${API_PORT}/health" 60 2 "Authorization: Bearer ${API_TOKEN}"

bun run scripts/run-api-suite.ts
