#!/bin/bash
set -euo pipefail

# =========================================================
# DropDex Local Launcher
# Starts the FastAPI backend (port 8000) and the
# Vite frontend (port 3000), then opens the app.
# =========================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

APP_URL="http://127.0.0.1:3000"
LOG_DIR="$DIR/logs"
FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_LOG="$LOG_DIR/backend.log"

FRONTEND_PID=""
BACKEND_PID=""

cleanup() {
  echo ""
  echo "Shutting down DropDex..."
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "${BACKEND_PID:-}" ]]  && kill "$BACKEND_PID"  2>/dev/null || true
}
trap cleanup EXIT INT TERM

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_cmd npm
require_cmd python3
require_cmd curl
require_cmd lsof

mkdir -p "$LOG_DIR"

# ── Preflight checks ─────────────────────────────────────────────

if [[ ! -f "$DIR/package.json" ]]; then
  echo "ERROR: package.json not found. Run this from the DropDex repo root."
  exit 1
fi

if [[ ! -f "$DIR/backend/.env" ]]; then
  echo "ERROR: backend/.env not found."
  echo "Copy backend/.env.example to backend/.env and fill in SUPABASE_URL and SUPABASE_SECRET_KEY."
  exit 1
fi

if ! grep -Eq "^SUPABASE_SECRET_KEY=.+" "$DIR/backend/.env"; then
  echo "ERROR: SUPABASE_SECRET_KEY is empty in backend/.env."
  echo "Set it to your Supabase service_role key (Dashboard → Settings → API → service_role)."
  exit 1
fi

if [[ ! -d "$DIR/backend/.venv" ]]; then
  echo "ERROR: backend/.venv not found."
  echo "Set up the backend first:"
  echo "  cd backend"
  echo "  python3 -m venv .venv && source .venv/bin/activate"
  echo "  pip install -r requirements.txt"
  echo "  pip install -e ../importer"
  exit 1
fi

# Install dropdex_importer if it's missing (e.g. after a fresh venv)
if ! (source "$DIR/backend/.venv/bin/activate" && python3 -c "import dropdex_importer" 2>/dev/null); then
  echo "dropdex_importer not found — installing from importer/..."
  (
    source "$DIR/backend/.venv/bin/activate"
    pip install -e "$DIR/importer/" --quiet
  )
  echo "dropdex_importer installed."
fi

# ── Kill anything already on the ports ───────────────────────────

echo "Cleaning up ports 3000 and 8000..."
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
lsof -ti :8000 | xargs kill -9 2>/dev/null || true

# ── Install frontend deps if needed ──────────────────────────────

if [[ ! -d "$DIR/node_modules" ]]; then
  echo "Installing frontend dependencies..."
  npm install
fi

# ── Start backend ─────────────────────────────────────────────────

echo "--- Starting backend (uvicorn 127.0.0.1:8000) ---"
: > "$BACKEND_LOG"

(
  cd "$DIR/backend"
  source .venv/bin/activate
  uvicorn app.main:app --host 127.0.0.1 --port 8000
) > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

echo "Waiting for backend..."
for i in {1..30}; do
  if curl -sf "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
    echo "Backend ready."
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend exited unexpectedly. Last 40 lines of $BACKEND_LOG:"
    tail -n 40 "$BACKEND_LOG" || true
    exit 1
  fi
  sleep 1
done

if ! curl -sf "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
  echo "Backend did not become reachable on port 8000."
  tail -n 40 "$BACKEND_LOG" || true
  exit 1
fi

# ── Start frontend ────────────────────────────────────────────────

echo "--- Starting frontend (Vite 127.0.0.1:3000) ---"
: > "$FRONTEND_LOG"

npm run dev > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

echo "Waiting for frontend..."
for i in {1..90}; do
  if curl -sf "$APP_URL" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "Frontend exited unexpectedly. Last 40 lines of $FRONTEND_LOG:"
    tail -n 40 "$FRONTEND_LOG" || true
    exit 1
  fi
  sleep 1
done

if ! curl -sf "$APP_URL" >/dev/null 2>&1; then
  echo "Frontend did not become reachable on port 3000."
  tail -n 40 "$FRONTEND_LOG" || true
  exit 1
fi

# ── Open browser ──────────────────────────────────────────────────

echo ""
echo "DropDex is running:"
echo "   Frontend  $APP_URL"
echo "   Backend   http://127.0.0.1:8000"
echo ""
echo "   Frontend log: $FRONTEND_LOG"
echo "   Backend log:  $BACKEND_LOG"
echo ""

open "$APP_URL" >/dev/null 2>&1 || true

echo "Running. Leave this window open. Press Ctrl+C to stop."
while true; do sleep 1; done
