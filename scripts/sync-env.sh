#!/usr/bin/env bash
#
# Fill this worktree's .env files from the main worktree's.
#
#   ./scripts/sync-env.sh          # fill empty/missing keys
#   ./scripts/sync-env.sh --check  # report what's missing, change nothing
#
# A linked worktree gets the tracked .env.example but never the untracked .env,
# so every fresh worktree boots with blank API keys. The failure is silent:
# `container.github()` throws ConfigError, modules/pulls/routes.ts downgrades it
# to a warn, and the PR list just renders empty.
#
# Only keys that are ABSENT or EMPTY locally are filled. A key that already has
# a value here is never overwritten — that's what keeps the per-worktree
# DATABASE_URL (devdigest_<branch>) and the API/WEB ports intact.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# The main worktree holds the real .git directory; linked worktrees point at it.
MAIN="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
if [ "$MAIN" = "$ROOT" ]; then
  log "already in the main worktree — nothing to sync"
  exit 0
fi

filled_any=0
for pkg in server client; do
  src="$MAIN/$pkg/.env"
  dst="$ROOT/$pkg/.env"
  [ -f "$src" ] || continue
  if [ ! -f "$dst" ]; then
    [ -f "$pkg/.env.example" ] && cp "$pkg/.env.example" "$dst" || : > "$dst"
  fi

  # Pass 1: which keys would change (names only — values are never printed).
  missing="$(awk -F= '
    FNR==NR { if ($0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) { v = substr($0, index($0,"=")+1); if (v != "") src[$1] = 1 } ; next }
    /^[A-Za-z_][A-Za-z0-9_]*=/ { v = substr($0, index($0,"=")+1); if (v != "") have[$1] = 1; seen[$1] = 1 }
    END { for (k in src) if (!have[k]) print k }
  ' "$src" "$dst" | sort | tr '\n' ' ')"

  if [ -z "$missing" ]; then
    log "$pkg/.env — complete"
    continue
  fi
  filled_any=1
  if [ "$CHECK_ONLY" -eq 1 ]; then
    warn "$pkg/.env — would fill: $missing"
    continue
  fi

  # Pass 2: rewrite in place, keeping local comments, order and set values.
  tmp="$(mktemp)"
  awk -F= '
    FNR==NR {
      if ($0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) { v = substr($0, index($0,"=")+1); if (v != "") src[$1] = v }
      next
    }
    {
      if ($0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) {
        key = $1; v = substr($0, index($0,"=")+1); seen[key] = 1
        if (v == "" && key in src) { print key "=" src[key]; next }
      }
      print
    }
    END {
      first = 1
      for (k in src) if (!(k in seen)) {
        if (first) { print ""; print "# synced from the main worktree by scripts/sync-env.sh"; first = 0 }
        print k "=" src[k]
      }
    }
  ' "$src" "$dst" > "$tmp"
  mv "$tmp" "$dst"
  chmod 600 "$dst"
  log "$pkg/.env — filled: $missing"
done

if [ "$filled_any" -eq 1 ]; then
  # --check is a gate: non-zero means "this worktree would be filled".
  [ "$CHECK_ONLY" -eq 1 ] && exit 1
  warn "restart the API so the new values are picked up (tsx watch does not reload .env)"
fi
exit 0
