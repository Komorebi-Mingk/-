#!/usr/bin/env bash
set -e

# Start backend server in background
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload --app-dir backend &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" >/dev/null 2>&1 || true
}

trap cleanup EXIT

# Start frontend dev server in foreground
npm run dev -- --host 0.0.0.0 --port 5173 --prefix frontend
