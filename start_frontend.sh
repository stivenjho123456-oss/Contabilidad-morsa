#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/apps/frontend"
npm run dev -- --host 127.0.0.1 --port 5175
