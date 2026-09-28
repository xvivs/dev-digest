# Sourced by the eval scripts. Builds a throwaway detached worktree of the
# current HEAD plus a snapshot of the working copy's .claude/skills, so evals
# run against the skills as they are on disk, not as last committed.
#
#   make_eval_worktree  → sets EVAL_WT (path) and EVAL_BASE (snapshot sha)
#   drop_eval_worktree  → removes it, including the cloned node_modules

SRC_ROOT="$(git rev-parse --show-toplevel)"
SKILL_SCRIPTS="$SRC_ROOT/.claude/skills/pr-self-review/scripts"

make_eval_worktree() {
  EVAL_WT="$(mktemp -d "${TMPDIR:-/tmp}/pr-self-review-eval.XXXXXX")"
  git -C "$SRC_ROOT" worktree add --detach --quiet "$EVAL_WT" HEAD
  # Copy-on-write clones, not symlinks: a symlink lets anything run in the eval
  # worktree (a package manager's auto-install) mutate the real node_modules,
  # and dependency-cruiser resolves it to a path outside the worktree, so the
  # arch:check baseline stops matching.
  for pkg in client server reviewer-core e2e; do
    if [ -d "$SRC_ROOT/$pkg/node_modules" ] && [ -d "$EVAL_WT/$pkg" ]; then
      if [ "$(uname)" = Darwin ]; then cp -Rc "$SRC_ROOT/$pkg/node_modules" "$EVAL_WT/$pkg/node_modules"
      else cp -R --reflink=auto "$SRC_ROOT/$pkg/node_modules" "$EVAL_WT/$pkg/node_modules"; fi
    fi
  done
  rm -rf "${EVAL_WT:?}/.claude/skills"
  mkdir -p "$EVAL_WT/.claude"
  cp -R "$SRC_ROOT/.claude/skills" "$EVAL_WT/.claude/skills"
  git -C "$EVAL_WT" add -A .claude/skills
  git -C "$EVAL_WT" -c user.name=pr-self-review-eval -c user.email=eval@localhost \
    commit --quiet --allow-empty -m "eval: skills snapshot"
  EVAL_BASE="$(git -C "$EVAL_WT" rev-parse HEAD)"
}

eval_commit() { # $1 = message
  # `node_modules/` in .gitignore matches directories only; the symlinks are files.
  git -C "$EVAL_WT" add -A -- . ':(exclude)*/node_modules'
  git -C "$EVAL_WT" -c user.name=pr-self-review-eval -c user.email=eval@localhost \
    commit --quiet -m "$1"
}

drop_eval_worktree() {
  [ -n "${EVAL_WT:-}" ] || return 0
  git -C "$SRC_ROOT" worktree remove --force "${EVAL_WT:?}"
  git -C "$SRC_ROOT" worktree prune
  EVAL_WT=""
}
