#!/usr/bin/env bash
# Pin Grok Bot's DevCodex connectors and driver to a clean runtime copy, separate from the dev checkout.
#   scripts/grok-bot-runtime.sh update  [runtimeDir] [branch]   clone if missing, then fast-forward only
#   scripts/grok-bot-runtime.sh restart [runtimeDir]            stop the runtime's profile/memory servers (host respawns them)
#   scripts/grok-bot-runtime.sh status  [runtimeDir]
# Defaults: runtimeDir=/workspace/devcodex-runtime, branch=current upstream branch of the runtime (or main for a new clone).
set -euo pipefail
cmd="${1:-status}"
RUNTIME="${2:-${DEVCODEX_GROK_BOT_RUNTIME:-/workspace/devcodex-runtime}}"
REMOTE_URL="${DEVCODEX_GROK_BOT_REMOTE:-https://github.com/devcodex-labs/devcodex.git}"
servers() { pgrep -f "node ${RUNTIME}/mcp/(profile|memory)-server\.js" || true; }
case "$cmd" in
  update)
    BRANCH="${3:-}"
    if [ ! -d "$RUNTIME/.git" ]; then
      git clone -q --branch "${BRANCH:-main}" "$REMOTE_URL" "$RUNTIME"
    else
      if [ -n "$(git -C "$RUNTIME" status --porcelain)" ]; then
        echo "runtime copy $RUNTIME has local changes; refusing to update" >&2; exit 2
      fi
      git -C "$RUNTIME" fetch -q origin
      if [ -n "$BRANCH" ] && [ "$(git -C "$RUNTIME" rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
        git -C "$RUNTIME" checkout -q "$BRANCH"
      fi
      git -C "$RUNTIME" merge -q --ff-only "@{upstream}"
    fi
    echo "runtime $(git -C "$RUNTIME" rev-parse --abbrev-ref HEAD)@$(git -C "$RUNTIME" rev-parse --short=8 HEAD); run '$0 restart' to load it"
    ;;
  restart)
    pids="$(servers)"
    if [ -n "$pids" ]; then kill $pids; echo "stopped: $pids (the host restarts connectors on next call)"; else echo "no running runtime servers"; fi
    ;;
  status)
    echo "runtime $(git -C "$RUNTIME" rev-parse --abbrev-ref HEAD 2>/dev/null)@$(git -C "$RUNTIME" rev-parse --short=8 HEAD 2>/dev/null)"
    echo "servers: $(servers | tr '\n' ' ')"
    ;;
  *) echo "usage: $0 update|restart|status [runtimeDir] [branch]" >&2; exit 64 ;;
esac
