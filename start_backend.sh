#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"
./.venv/bin/python -m uvicorn app.main:app --app-dir apps/backend --host 127.0.0.1 --port 8010
