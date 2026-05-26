#!/bin/bash
set -euo pipefail

# =========================================================
# DropDex Local Launcher
# - Starts the Vite frontend from the repo root
# - Uses the project's configured dev port (:3000)
# - Opens the app in your browser
#
# Notes:
# - This launches the app locally only.
# - Uses Dexie (IndexedDB) for local storage — no backend needed.
# - The app expects GEMINI_API_KEY in .env or .env.local.
# =========================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

APP_URL="http://127.0.0.1:3000"
LOG_DIR="$DIR/logs"
LOG_FILE="$LOG_DIR/frontend.log"

cleanup() {
  echo ""
  echo "Shutting down DropDex..."
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

has_env_var() {
  local var_name="$1"
  local file
  for file in ".env.local" ".env"; do
    if [[ -f "$file" ]] && grep -Eq "^[[:space:]]*${var_name}=" "$file"; then
      return 0
    fi
  done
  return 1
}

echo "Starting DropDex locally..."

if [[ ! -f "$DIR/package.json" ]]; then
  echo "package.json not found. Put this launch.command in the DropDex repo root."
  exit 1
fi

require_cmd npm
require_cmd curl
require_cmd lsof

mkdir -p "$LOG_DIR"

# Validate env file and required API key.
if [[ ! -f "$DIR/.env" && ! -f "$DIR/.env.local" ]]; then
  echo "Missing .env or .env.local in the project root."
  echo "DropDex expects GEMINI_API_KEY. Copy .env.example and fill it in."
  exit 1
fi

if ! has_env_var "GEMINI_API_KEY"; then
  echo "Missing GEMINI_API_KEY in .env or .env.local."
  echo "Copy .env.example, rename it to .env, and set your Gemini API key."
  exit 1
fi

echo "Cleaning up anything already using port 3000..."
lsof -ti :3000 | xargs kill -9 2>/dev/null || true

# Install dependencies if needed.
if [[ ! -d "$DIR/node_modules" ]]; then
  echo "node_modules not found. Installing dependencies..."
  npm install
fi

echo "--- Starting frontend (Vite :3000) ---"
: > "$LOG_FILE"

npm run dev > "$LOG_FILE" 2>&1 &
FRONTEND_PID=$!

echo "Waiting for DropDex to be reachable at $APP_URL ..."
for i in {1..90}; do
  if curl -s -I "$APP_URL" >/dev/null 2>&1; then
    break
  fi

  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "DropDex exited unexpectedly. Last 100 lines of $LOG_FILE:"
    tail -n 100 "$LOG_FILE" || true
    exit 1
  fi

  sleep 1
done

if ! curl -s -I "$APP_URL" >/dev/null 2>&1; then
  echo "DropDex did not become reachable on port 3000."
  echo "Last 100 lines of $LOG_FILE:"
  tail -n 100 "$LOG_FILE" || true
  exit 1
fi

echo ""
echo "DropDex is running:"
echo "   $APP_URL"
echo ""
echo "   frontend log: $LOG_FILE"
echo ""

open "$APP_URL" >/dev/null 2>&1 || true

echo "Running. Leave this window open. Press Ctrl+C to stop."
while true; do sleep 1; done
