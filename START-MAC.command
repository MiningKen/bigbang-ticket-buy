#!/bin/zsh
set -e
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

if [[ ! -d node_modules/playwright-core ]]; then
  npm install
fi

npm run app
