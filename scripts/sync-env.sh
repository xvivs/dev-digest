#!/usr/bin/env bash
#
# Make this worktree runnable: answer pnpm's build-script prompts, then fill
# its .env files from the main worktree's.
#
#   ./scripts/sync-env.sh          # fix what's missing
#   ./scripts/sync-env.sh --check  # report what's missing, change nothing
#
# Two unrelated things break a fresh worktree, both because the files that fix
# them are untracked and so are never inherited:
#
#   1. pnpm 11 refuses to install while any dependency's build script is
#      undecided. `pnpm install` exits 1 on [ERR_PNPM_IGNORED_BUILDS] and, in
#      the same breath, writes <pkg>/pnpm-workspace.yaml with an `allowBuilds:`
#      map whose values are the literal string "set this to true or false".
#      Every `pnpm <script>` runs a deps-status preflight that shells out to
#      `pnpm install`, so until those are real booleans nothing runs at all —
#      typecheck, test, db:migrate, and therefore dev.sh and e2e.sh.
#
#   2. A linked worktree gets the tracked .env.example but never the untracked
#      .env, so it boots with blank API keys. That failure is silent:
#      `container.github()` throws ConfigError, modules/pulls/routes.ts
#      downgrades it to a warn, and the PR list just renders empty.
#
# Only values that are ABSENT or UNANSWERED are written. Anything already set
# here is never overwritten — that's what keeps the per-worktree DATABASE_URL
# (devdigest_<branch>) and the API/WEB ports intact.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# The main worktree holds the real .git directory; linked worktrees point at it.
MAIN="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"

changed=0     # anything would change / did change — drives --check's exit code
env_filled=0  # .env specifically — only that needs an API restart

# --- pnpm allowBuilds --------------------------------------------------------
# Runs in EVERY worktree, the main one included: pnpm's prompt is per
# node_modules, not per checkout. The decision is remembered in
# node_modules/.modules.yaml rather than in the yaml, which is why a worktree
# whose deps are already built looks healthy while a fresh one dies on install.
#
# `false` is the answer: nothing here needs those build scripts to have run
# (dev server, tsx, vitest and drizzle-kit are all fine without them), and
# cpu-features is a native compile that commonly fails. An answer already
# present in the main worktree wins, so flipping one there propagates outward.
WS_PLACEHOLDER="set this to true or false"

answer_allow_builds() {
  local pkg="$1"
  local dst="$ROOT/$pkg/pnpm-workspace.yaml"
  local src="$MAIN/$pkg/pnpm-workspace.yaml"
  [ -d "$ROOT/$pkg" ] || return 0

  # No file and no node_modules: this worktree has never installed, so the
  # first `pnpm install` is the one that fails. Seed the file BEFORE it runs —
  # the file pnpm wants answered is the one that install itself creates, so
  # there is no ordering in which answering afterwards helps the first run.
  if [ ! -f "$dst" ]; then
    if [ -d "$ROOT/$pkg/node_modules" ]; then
      return 0  # already installed, so the decision is recorded in .modules.yaml
    fi
    changed=1
    if [ "$CHECK_ONLY" -eq 1 ]; then
      warn "$pkg/pnpm-workspace.yaml — would seed (no file, deps not installed)"
      return 0
    fi
    if [ -f "$src" ]; then
      cp "$src" "$dst"
      log "$pkg/pnpm-workspace.yaml — copied from the main worktree"
    else
      # Key-agnostic fallback: the main worktree has no answers to copy and the
      # package list is not knowable until install runs. This restores pnpm 10
      # behaviour (skipped builds warn instead of failing); pnpm still appends
      # the allowBuilds placeholders, which the branch below answers next run.
      printf 'strictDepBuilds: false\n' > "$dst"
      log "$pkg/pnpm-workspace.yaml — seeded with strictDepBuilds: false"
    fi
    return 0
  fi

  if ! grep -qF "$WS_PLACEHOLDER" "$dst"; then
    log "$pkg/pnpm-workspace.yaml — answered"
    return 0
  fi

  local pending
  pending="$(grep -F "$WS_PLACEHOLDER" "$dst" | sed 's/^[[:space:]]*//; s/:.*$//' | sort | tr '\n' ' ')"
  changed=1
  if [ "$CHECK_ONLY" -eq 1 ]; then
    warn "$pkg/pnpm-workspace.yaml — would answer: $pending"
    return 0
  fi

  # Not FNR==NR: when the first file is empty (/dev/null) FNR and NR stay in
  # lockstep through the second one, so every line would be read as pass 1 and
  # the output would come out empty. Match on FILENAME instead.
  local srcfile=/dev/null
  if [ -f "$src" ] && [ "$src" != "$dst" ]; then srcfile="$src"; fi

  local tmp
  tmp="$(mktemp)"
  awk -v ph="$WS_PLACEHOLDER" -v srcfile="$srcfile" '
    # Pass 1 (main worktree, if it has a file): remember keys already decided.
    FILENAME == srcfile {
      if ($0 ~ /^[[:space:]]+[^[:space:]]+:/ && index($0, ph) == 0) {
        k = $1; sub(/:$/, "", k); if ($2 != "") ans[k] = $2
      }
      next
    }
    # Pass 2: replace every placeholder, keeping indentation and key order.
    {
      if (index($0, ph) > 0) {
        k = $1; sub(/:$/, "", k)
        indent = $0; sub(/[^[:space:]].*$/, "", indent)
        print indent k ": " (k in ans ? ans[k] : "false")
        next
      }
      print
    }
  ' "$srcfile" "$dst" > "$tmp"
  mv "$tmp" "$dst"
  log "$pkg/pnpm-workspace.yaml — answered: $pending"
}

for pkg in server client reviewer-core; do
  answer_allow_builds "$pkg"
done

if [ "$MAIN" = "$ROOT" ]; then
  log "main worktree — .env sync not applicable"
  if [ "$CHECK_ONLY" -eq 1 ] && [ "$changed" -eq 1 ]; then exit 1; fi
  exit 0
fi

# --- .env --------------------------------------------------------------------
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
  changed=1
  env_filled=1
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

if [ "$changed" -eq 1 ]; then
  # --check is a gate: non-zero means "this worktree would be changed".
  if [ "$CHECK_ONLY" -eq 1 ]; then exit 1; fi
  if [ "$env_filled" -eq 1 ]; then
    warn "restart the API so the new values are picked up (tsx watch does not reload .env)"
  fi
fi
exit 0
