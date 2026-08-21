#!/usr/bin/env bash

set -euo pipefail

jq empty manifest.json _locales/en/messages.json _locales/zh_CN/messages.json

for javascript_file in src/*.js scripts/*.mjs; do
  node --check "$javascript_file"
done
