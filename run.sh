#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

echo "[setup] backend"
cd "$BACKEND_DIR"
if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt >/dev/null
if [[ ! -f ".env" ]]; then
  cp .env.example .env
fi

echo "[setup] frontend"
cd "$FRONTEND_DIR"
npm install >/dev/null
if [[ ! -f ".env.local" ]]; then
  cp .env.example .env.local
fi

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[run] backend http://127.0.0.1:8000"
(
  cd "$BACKEND_DIR"
  source .venv/bin/activate
  uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
) &

echo "[run] frontend http://127.0.0.1:3000"
(
  cd "$FRONTEND_DIR"
  npm run dev -- --hostname 127.0.0.1 --port 3000
) &

wait
