#!/usr/bin/env bash

set -euo pipefail

jq empty manifest.json _locales/en/messages.json _locales/zh_CN/messages.json

for javascript_file in src/*.js scripts/*.mjs; do
  node --check "$javascript_file"
done

star_history_preview="$(mktemp -t longshot-star-history.XXXXXX.svg)"
trap 'rm -f "$star_history_preview"' EXIT

GITHUB_REPOSITORY=zluckyhou/longshot \
REPOSITORY_CREATED_AT=2026-08-21T11:31:24Z \
STAR_HISTORY_OUTPUT="$star_history_preview" \
  node scripts/update-star-history.mjs --empty

test -s "$star_history_preview"
