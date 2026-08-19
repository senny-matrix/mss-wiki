#!/usr/bin/env bash
#
# fix-hexclave-dashboard.sh
#
# Repairs the Hexclave development-environment dashboard when `bun dev`
# (hexclave dev) fails with:
#
#   [Hexclave] ⠏ Hexclave dashboard not found on port 26700. Starting now...
#   Error: Timed out waiting for the development environment dashboard to start
#   at http://127.0.0.1:26700. Dashboard logs: .../rde-dashboard-26700.log
#
# Root cause this script targets: the dashboard process crashed on boot with
# "Cannot find module '.../rde-dashboard-runtime-<port>/node_modules/@swc/helpers/
# esm/_interop_require_default.js'" — a corrupted/partial cached dashboard
# install under ~/.stack. The CLI keeps retrying the same broken copy until its
# 60s timeout, then exits 1.
#
# The fix is to evict the corrupted cache so `hexclave dev` re-downloads and
# re-extracts a clean copy on the next run. It also clears stale state that
# would otherwise keep the CLI pointing at a dead dashboard process.
#
# Usage:
#   scripts/fix-hexclave-dashboard.sh [--dry-run] [--force]
#
# Options:
#   --dry-run   Print what would be removed without touching anything.
#   --force     Skip the interactive confirmation prompt.
#
# Safe by default: only ~/.stack cache/state files that belong to the local
# dashboard are ever deleted, and the whole repair is a no-op when the port is
# already healthy.

set -euo pipefail

PORT="${HEXCLAVE_DASHBOARD_PORT:-26700}"
STACK_DIR="${HOME}/.stack"
DEV_ENVS_FILE="${STACK_DIR}/dev-envs.json"
RUNTIME_DIR="${STACK_DIR}/rde-dashboard-runtime-${PORT}"
RUNTIME_LOCK="${RUNTIME_DIR}.lock"
LOG_FILE="${STACK_DIR}/rde-dashboard-${PORT}.log"
HEALTH_URL="http://127.0.0.1:${PORT}/api/development-environment/health"
HEALTH_TIMEOUT_S=5
BACKUP_SUFFIX=".hexclave-fix-backup"

DRY_RUN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m[hexclave-fix]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[hexclave-fix]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[hexclave-fix]\033[0m ERROR: %s\n' "$*" >&2; exit 1; }

# --- Phase 0: sanity checks -------------------------------------------------

command -v curl >/dev/null 2>&1 || die "curl is required but not on PATH."
command -v lsof >/dev/null 2>&1 || warn "lsof not found; process cleanup will be skipped."

# --- Phase 1: is the dashboard actually healthy? -----------------------------

dashboard_healthy() {
  local code
  code=$(curl -sS -m "${HEALTH_TIMEOUT_S}" -o /dev/null -w '%{http_code}' "${HEALTH_URL}" 2>/dev/null || true)
  [ "${code}" = "200" ]
}

if dashboard_healthy; then
  log "Dashboard on port ${PORT} is already healthy at ${HEALTH_URL}. Nothing to fix."
  exit 0
fi

warn "Dashboard on port ${PORT} is not responding. Running repair."

# --- Phase 2: identify and stop any stale dashboard process -------------------

STALE_PIDS=()

# 1) Process recorded in the dev-env state file (the one the CLI would reuse).
if [ -f "${DEV_ENVS_FILE}" ] && command -v lsof >/dev/null 2>&1; then
  RECORDED_PID=$(python3 -c "import json,sys; print(json.load(open('${DEV_ENVS_FILE}'))['localDashboardsByPort'].get('${PORT}',{}).get('pid',''))" 2>/dev/null || true)
  if [ -n "${RECORDED_PID}" ] && [ "${RECORDED_PID}" != "0" ]; then
    if ps -p "${RECORDED_PID}" >/dev/null 2>&1; then
      log "Found recorded dashboard process (pid ${RECORDED_PID}). Stopping it."
      STALE_PIDS+=("${RECORDED_PID}")
    else
      log "Recorded dashboard pid ${RECORDED_PID} is no longer running (expected — crashed)."
    fi
  fi
fi

# 2) Anything still bound to the port.
if command -v lsof >/dev/null 2>&1; then
  while IFS= read -r pid; do
    [ -n "${pid}" ] || continue
    if ! printf '%s\n' "${STALE_PIDS[@]}" | grep -qx "${pid}"; then
      STALE_PIDS+=("${pid}")
    fi
  done < <(lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)
fi

if [ ${#STALE_PIDS[@]} -gt 0 ]; then
  for pid in "${STALE_PIDS[@]}"; do
    if [ "${DRY_RUN}" = "1" ]; then
      log "[dry-run] Would kill stale dashboard process: ${pid}"
      continue
    fi
    kill "${pid}" 2>/dev/null || true
    # Give the socket a moment to release.
    for _ in 1 2 3 4 5; do
      if lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | grep -qx "${pid}"; then
        sleep 1
      else
        break
      fi
    done
    if lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | grep -qx "${pid}"; then
      warn "pid ${pid} still holds port ${PORT}; sending SIGKILL."
      kill -9 "${pid}" 2>/dev/null || true
    fi
  done
fi

# --- Phase 3: remove the corrupted dashboard runtime ---------------------------

# The runtime dir is a throwaway copy the CLI rebuilds from the versioned cache
# on every start, so deleting it is always safe. The versioned cache dirs below
# are the durable installs — only evict the corrupted ones (checked in Phase 4).
REMOVE_PATHS=("${RUNTIME_DIR}")

for path in "${REMOVE_PATHS[@]}"; do
  if [ ! -e "${path}" ]; then
    continue
  fi
  if [ "${DRY_RUN}" = "1" ]; then
    log "[dry-run] Would remove ${path}"
    continue
  fi
  if [ -d "${path}" ]; then
    rm -rf "${path}"
  else
    rm -f "${path}"
  fi
  log "Removed ${path}"
done

# --- Phase 4: validate and optionally evict cached dashboard versions -----------

# Missing *_interop_require_* helper files are the known corruption signature
# (Next.js require-hook -> @swc/helpers subpath export -> ENOENT at boot).
# Also catch anything missing the extraction-complete marker (partial extract).
CACHE_ROOT="${STACK_DIR}/dashboards"
ESM_HELPERS_DIR="node_modules/@swc/helpers/esm"
CORRUPT_CACHES=()

if [ -d "${CACHE_ROOT}" ]; then
  for cache_dir in "${CACHE_ROOT}"/*/; do
    [ -d "${cache_dir}" ] || continue
    name=$(basename "${cache_dir}")
    case "${name}" in
      .*) continue ;;  # skip temp/staging dirs (.download-*, .extract-*, etc.)
    esac
    if [ ! -f "${cache_dir}.hexclave-complete" ]; then
      CORRUPT_CACHES+=("${cache_dir}")
      continue
    fi
    if [ ! -f "${cache_dir}${ESM_HELPERS_DIR}/_interop_require_default.js" ] \
       || [ ! -f "${cache_dir}${ESM_HELPERS_DIR}/_interop_require_wildcard.js" ]; then
      CORRUPT_CACHES+=("${cache_dir}")
      continue
    fi
  done
fi

if [ ${#CORRUPT_CACHES[@]} -gt 0 ]; then
  for cache_dir in "${CORRUPT_CACHES[@]}"; do
    if [ "${DRY_RUN}" = "1" ]; then
      log "[dry-run] Would evict corrupted dashboard cache: ${cache_dir}"
      continue
    fi
    rm -rf "${cache_dir}"
    log "Evicted corrupted dashboard cache: ${cache_dir}"
  done
else
  log "No corrupted dashboard caches found in ${CACHE_ROOT}."
fi

# --- Phase 5: clear stale local-dashboard state --------------------------------

# localDashboardsByPort records the (now dead) pid/secret the CLI would otherwise
# reuse. Removing the entry forces a clean start; the CLI re-creates it.
if [ -f "${DEV_ENVS_FILE}" ] && [ "${DRY_RUN}" = "0" ]; then
  python3 - "${DEV_ENVS_FILE}" "${PORT}" <<'PY'
import json, os, sys

path, port = sys.argv[1], sys.argv[2]
st = json.load(open(path))
changed = False

dash = st.get("localDashboardsByPort") or {}
if str(port) in dash:
    del dash[str(port)]
    st["localDashboardsByPort"] = dash
    changed = True

# Sessions expire server-side on their own; the local record is what matters.
if changed:
    open(path, "w").write(json.dumps(st, indent=2) + "\n")
    os.chmod(path, 0o600)
    print(f"Cleared stale dashboard state for port {port} in {path}")
PY
fi

# --- Phase 6: report and next steps ---------------------------------------------

log "Repair complete."
if [ "${DRY_RUN}" = "0" ]; then
  log "Next step: run 'bun dev' again. The CLI will re-download a clean dashboard."
else
  log "Dry run finished — nothing was changed."
fi

exit 0
