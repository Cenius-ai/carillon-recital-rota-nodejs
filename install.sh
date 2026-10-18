#!/usr/bin/env bash
# Carillon Recital Rota — install, prepare the data store, seed the demo rota.
# Runs unprivileged, installs no system packages, and EXITS without starting
# the HTTP server (start that separately with: node server.js).
# POSIX-safe so it runs under both `sh install.sh` and `bash install.sh`.
set -eu

cd "$(dirname "$0")"

echo "[install] Carillon Recital Rota"
echo "[install] Runtime: Node.js built-ins only — no third-party packages to install."

if ! command -v node >/dev/null 2>&1; then
  echo "[install] Node.js was not found on PATH. Install Node 20 (see INSTALL.md) and re-run." >&2
  exit 1
fi

node -e 'const major = Number(process.versions.node.split(".")[0]); if (major < 18) { console.error("[install] Node 18 or newer is required; found " + process.versions.node); process.exit(1); } console.log("[install] Node " + process.versions.node + " detected.");'

mkdir -p data

# Optional lockfile install. There are no runtime dependencies, so this is a
# no-op today, but it keeps the standard workflow honest if one is ever added.
if [ -f package-lock.json ]; then
  if command -v npm >/dev/null 2>&1; then
# node version advisory (auto-added by cenius)
if command -v node >/dev/null 2>&1; then
  _REQ_NODE="$(node -p "(require('./package.json').engines||{}).node||''" 2>/dev/null || true)"
  [ -n "$_REQ_NODE" ] && echo "-> This app requires Node $_REQ_NODE (you have $(node -v)). If install fails with EBADENGINE, upgrade Node: https://nodejs.org"
fi
    npm install --no-audit --no-fund --ignore-scripts
  fi
fi

# Seed the demo rota. Idempotent: existing records are never duplicated.
node seed.js

echo "[install] Done."
echo "[install] Start the app with:   node server.js        (binds 0.0.0.0, honours \$PORT, default 3000)"
echo "[install] Sign in with:         cenius@cenius.ai / cenius"
echo "[install] Run the tests with:   npm test"
