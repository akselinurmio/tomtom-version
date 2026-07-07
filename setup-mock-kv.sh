#!/bin/bash

set -euo pipefail

TODAY=$(date -u +"%Y-%m-%d")
CHECKED_AT=$(date -u +%s)000

echo "Adding last_checked (current state) to MAP_VERSION_CHANGES..."
npx wrangler kv key put \
  --binding=MAP_VERSION_CHANGES \
  --local \
  "last_checked" \
  "{\"version\":\"2024\",\"checked_at\":$CHECKED_AT}"

echo "Adding a change entry to MAP_VERSION_CHANGES..."
VERSION_CHANGE='{"created_at":1731974400000,"from_version":"2023","to_version":"2024"}'
npx wrangler kv key put \
  --binding=MAP_VERSION_CHANGES \
  --local \
  "$TODAY" \
  "$VERSION_CHANGE" \
  --metadata '{"from_version":"2023","to_version":"2024"}'

echo "Adding last_change pointer to MAP_VERSION_CHANGES..."
npx wrangler kv key put \
  --binding=MAP_VERSION_CHANGES \
  --local \
  "last_change" \
  "$TODAY"

echo "Mock KV data setup complete!"
