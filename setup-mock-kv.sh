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

echo "Adding earlier change entries (for release cadence stats)..."
for ENTRY in "2025-03-10 2021 2022" "2025-06-02 2022 2023"; do
  read -r DATE FROM TO <<<"$ENTRY"
  CREATED_AT=$(($(date -u +%s) * 1000))
  npx wrangler kv key put \
    --binding=MAP_VERSION_CHANGES \
    --local \
    "$DATE" \
    "{\"created_at\":$CREATED_AT,\"from_version\":\"$FROM\",\"to_version\":\"$TO\"}" \
    --metadata "{\"from_version\":\"$FROM\",\"to_version\":\"$TO\"}"
done

echo "Adding a change entry to MAP_VERSION_CHANGES..."
VERSION_CHANGE="{\"created_at\":$CHECKED_AT,\"from_version\":\"2023\",\"to_version\":\"2024\"}"
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
