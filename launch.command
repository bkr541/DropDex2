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
ELECTRON_LOG="$LOG_DIR/electron.log"
BACKEND_LOG="$LOG_DIR/backend.log"
ELECTRON_BIN="$DIR/node_modules/.bin/electron"

FRONTEND_PID=""
ELECTRON_PID=""
BACKEND_PID=""

cleanup() {
  echo ""
  echo "Shutting down DropDex..."
  [[ -n "${ELECTRON_PID:-}" ]] && kill "$ELECTRON_PID" 2>/dev/null || true
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

# ── Install and verify frontend/Electron dependencies ───────────

install_frontend_dependencies() {
  echo "Installing frontend and Electron development dependencies..."
  # Electron is a devDependency. --include=dev overrides npm configs such as
  # NODE_ENV=production or omit=dev that would otherwise silently skip it.
  npm install --include=dev
}

# node_modules may predate the Electron conversion, so checking only whether
# the directory exists is not enough. Repair the dependency set when the
# Electron CLI is absent.
if [[ ! -d "$DIR/node_modules" || ! -x "$ELECTRON_BIN" ]]; then
  install_frontend_dependencies
fi

# A cancelled Electron download can leave the npm package and .bin shim in
# place without a usable native runtime. Ask Electron for its version and
# rebuild it once when that smoke test fails.
if [[ -x "$ELECTRON_BIN" ]] && ! "$ELECTRON_BIN" --version >/dev/null 2>&1; then
  echo "Electron is present but incomplete; repairing its native runtime..."
  npm rebuild electron
fi

if [[ ! -x "$ELECTRON_BIN" ]] || ! "$ELECTRON_BIN" --version >/dev/null 2>&1; then
  echo "ERROR: Electron could not be installed or started from $ELECTRON_BIN."
  echo "Try the following from the DropDex repo root:"
  echo "  rm -rf node_modules/electron node_modules/.bin/electron"
  echo "  npm install --include=dev"
  echo ""
  echo "Node version: $(node --version 2>/dev/null || echo unavailable)"
  echo "npm omit setting: $(npm config get omit 2>/dev/null || echo unavailable)"
  exit 1
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

npm run dev:web > "$FRONTEND_LOG" 2>&1 &
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

# ── Start Electron shell ───────────────────────────────────────────

echo "--- Starting Electron desktop app ---"
: > "$ELECTRON_LOG"
ELECTRON_RENDERER_URL="$APP_URL" "$ELECTRON_BIN" "$DIR" > "$ELECTRON_LOG" 2>&1 &
ELECTRON_PID=$!

sleep 2
if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
  echo "Electron exited unexpectedly. Last 40 lines of $ELECTRON_LOG:"
  tail -n 40 "$ELECTRON_LOG" || true
  exit 1
fi

echo ""
echo "DropDex desktop is running:"
echo "   Renderer  $APP_URL"
echo "   Backend   http://127.0.0.1:8000"
echo ""
echo "   Frontend log: $FRONTEND_LOG"
echo "   Electron log: $ELECTRON_LOG"
echo "   Backend log:  $BACKEND_LOG"
echo ""

echo "Running. Leave this window open. Press Ctrl+C to stop."
while true; do sleep 1; done
