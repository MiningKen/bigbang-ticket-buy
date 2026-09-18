#!/bin/zsh
set -e
cd "$(dirname "$0")"

if [[ ! -f .kham.env ]]; then
  cp .kham.env.example .kham.env
fi

if [[ ! -d node_modules/playwright-core ]]; then
  npm install
fi

npm run kham
