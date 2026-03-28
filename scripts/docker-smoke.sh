#!/bin/bash
set -e

echo "=== Shuvcrawl Docker Smoke Test ==="

# Build and start the container
echo "Building and starting container..."
docker compose up -d --build

# Wait for health endpoint
echo "Waiting for service to be healthy..."
for i in {1..30}; do
  if curl -sf http://localhost:3777/health > /dev/null 2>&1; then
    echo "Service is healthy!"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "ERROR: Service failed to become healthy within 60 seconds"
    docker compose logs
    docker compose down
    exit 1
  fi
  sleep 2
done

# Test scrape endpoint
echo "Testing POST /scrape endpoint..."
RESPONSE=$(curl -sf -X POST http://localhost:3777/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' 2>&1) || {
  echo "ERROR: Scrape request failed"
  echo "Response: $RESPONSE"
  docker compose logs
  docker compose down
  exit 1
}

if echo "$RESPONSE" | grep -q '"success":true'; then
  echo "Scrape test passed!"
else
  echo "ERROR: Scrape response did not contain success"
  echo "Response: $RESPONSE"
  docker compose logs
  docker compose down
  exit 1
fi

# Cleanup
echo "Tests passed! Cleaning up..."
docker compose down

echo "=== Smoke test completed successfully ==="
exit 0
