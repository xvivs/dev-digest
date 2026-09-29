#!/usr/bin/env bash
# Allow/block matrix for gate-hook.mjs in a throwaway worktree. No LLM.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_worktree.sh"
HOOK="$SKILL_SCRIPTS/gate-hook.mjs"

make_eval_worktree
OTHER=""
drop_all() { [ -z "$OTHER" ] || git -C "$SRC_ROOT" worktree remove --force "$OTHER" 2>/dev/null || true; drop_eval_worktree; }
trap drop_all EXIT
echo "export const EVAL_HOOK = 1;" > "$EVAL_WT/reviewer-core/src/eval-hook.ts"
eval_commit "eval: hook case"

fails=0
expect() { # $1 = expected exit, $2 = command, $3 = optional stderr substring
  local payload code err
  payload="$(node -e 'console.log(JSON.stringify({tool_name:"Bash",tool_input:{command:process.argv[1]},cwd:process.argv[2]}))' "$2" "$EVAL_WT")"
  set +e
  err="$(printf '%s' "$payload" | node "$HOOK" 2>&1 >/dev/null)"
  code=$?
  set -e
  if [ "$code" = "$1" ] && { [ -z "${3:-}" ] || grep -q -- "$3" <<<"$err"; }; then
    echo "ok   [$code] $2"
  else
    echo "FAIL [$code, want $1] $2"; [ -n "$err" ] && echo "     $err"
    fails=$((fails + 1))
  fi
}

STAMP_WT=""  # empty = the session worktree; set to $OTHER to stamp the other one
stamp() { # $1 = verdict, $2 = level ("checks" | "full" | omitted = legacy, no level field)
  local verdict="$1" level="${2:-}" level_line=""
  if [ -n "$level" ]; then level_line="s.level = '$level';"; fi
  (cd "${STAMP_WT:-$EVAL_WT}" && node --input-type=module -e "
    import { branchDiff, stateDir } from '$SKILL_SCRIPTS/lib.mjs';
    import { mkdirSync, writeFileSync } from 'node:fs';
    const d = branchDiff(process.cwd());
    mkdirSync(stateDir(process.cwd()), { recursive: true });
    const s = { diffHash: d.diffHash, verdict: '$verdict', criticals: '$verdict' === 'PASS' ? 0 : 1, blocking: '$verdict' === 'PASS' ? [] : ['[eval] fake critical'] };
    $level_line
    writeFileSync(stateDir(process.cwd()) + '/' + d.diffHash + '.json', JSON.stringify(s));
  ")
}

echo "-- no stamp"
expect 0 "ls -la"
expect 0 "git status"
expect 0 "git log --grep push"
expect 0 'echo "git push"'
expect 2 "git push" "/pr-self-review"
expect 2 "git push -u origin HEAD" "/pr-self-review"
expect 2 "gh pr create --fill" "/pr-self-review"
expect 2 "cd server && gh pr create --draft" "/pr-self-review"
expect 0 "git push --tags"
expect 0 "git push origin --delete old-branch"
expect 0 "git push origin :old-branch"
expect 0 "git push --dry-run"
expect 0 "git push origin refs/tags/v1.0.0"
expect 2 "git push origin :old-branch HEAD" "/pr-self-review"
expect 2 "git push origin other:other" "не з поточної гілки"
expect 2 "git push --all" "--all"
expect 2 'git add . && git commit -m "wip" && git push' "змінює HEAD"
expect 2 "gh pr create --head someone:other" "не з поточної гілки"

echo "-- BLOCK stamp"
stamp BLOCK
expect 2 "git push" "BLOCK"

echo "-- PASS stamp"
stamp PASS
expect 0 "git push"
expect 0 "gh pr create --fill"
expect 2 'git commit --amend --no-edit && git push' "змінює HEAD"

echo "-- new commit after PASS"
echo "export const EVAL_HOOK_2 = 2;" >> "$EVAL_WT/reviewer-core/src/eval-hook.ts"
eval_commit "eval: change after pass"
expect 2 "git push" "/pr-self-review"

echo "-- checks-only stamp"
stamp PASS checks
expect 0 "git push"
expect 2 "gh pr create --fill" "/pr-self-review"

echo "-- full stamp"
stamp PASS full
expect 0 "git push"
expect 0 "gh pr create --fill"

echo "-- legacy stamp (no level field, counts as full)"
stamp PASS
expect 0 "git push"
expect 0 "gh pr create --fill"

echo "-- FAIL stamp, checks level"
stamp BLOCK checks
expect 2 "git push" "BLOCK"
expect 2 "gh pr create --fill" "BLOCK"

echo "-- FAIL stamp, full level"
stamp BLOCK full
expect 2 "git push" "BLOCK"
expect 2 "gh pr create --fill" "BLOCK"

echo "-- redirects / pipes / separators are not push arguments (PASS stamp)"
stamp PASS checks
expect 0 "git push -u origin HEAD 2>&1 | tail -25"
expect 0 "git push 2>&1 | tail -25"
expect 0 "git push origin HEAD > /dev/null 2>&1 && echo done"
expect 0 "git push origin HEAD &>/dev/null; echo done"
expect 0 "git push origin HEAD 2>/dev/null || true"
expect 0 "git --no-pager push origin HEAD"
expect 0 'echo "git push" 2>&1 | cat'
expect 0 "git log --grep 'git push' | cat"
expect 2 "git push -u origin other-branch 2>&1 | tail -25" "не з поточної гілки"
expect 2 "gh pr create --fill 2>&1 | tail" "рівень"

echo "-- recognised through global git options, no stamp"
rm -rf "$EVAL_WT/.devdigest"
expect 2 "git -c x=y push" "/pr-self-review"
expect 2 "git -c x=y -c a=b push origin HEAD 2>&1 | tail" "/pr-self-review"
expect 2 "git --no-pager push" "/pr-self-review"
expect 2 "/usr/bin/git push" "/pr-self-review"
expect 2 "env GIT_TRACE=1 git push" "/pr-self-review"
expect 2 'bash -c "git push"' "/pr-self-review"
expect 2 'echo "$(git push)"' "/pr-self-review"
expect 2 "gh -R owner/repo pr create --fill" "/pr-self-review"
expect 2 "gh pr create --fill -R owner/repo" "/pr-self-review"
expect 2 "gh pr create --head=someone:other" "не з поточної гілки"
stamp PASS full
expect 0 "git -c x=y push"
expect 0 "gh -R owner/repo pr create --fill"

echo "-- other worktree: stamp and branch come from the -C / cd target"
OTHER="$(mktemp -d "${TMPDIR:-/tmp}/pr-self-review-eval-other.XXXXXX")"
git -C "$EVAL_WT" worktree add --detach --quiet "$OTHER" HEAD
echo "export const EVAL_OTHER = 1;" > "$OTHER/reviewer-core/src/eval-other.ts"
git -C "$OTHER" add -A reviewer-core/src/eval-other.ts
git -C "$OTHER" -c user.name=pr-self-review-eval -c user.email=eval@localhost commit --quiet -m "eval: other worktree"
# the session worktree holds a PASS stamp, the other one has none
expect 2 "git -C $OTHER push -u origin HEAD" "репозиторій"
expect 2 "git -C $OTHER push -u origin HEAD 2>&1 | tail -25" "/pr-self-review"
expect 2 "git -C $OTHER -c x=y push" "репозиторій"
expect 2 "git --work-tree=$OTHER push" "репозиторій"
expect 2 "cd $OTHER && git push" "репозиторій"
expect 2 "cd $OTHER; git push -u origin HEAD 2>&1 | tail" "репозиторій"
expect 2 "(cd $OTHER && git push)" "репозиторій"
expect 2 "cd $OTHER && gh pr create --fill" "репозиторій"
expect 0 "(cd $OTHER && ls); git push"      # the subshell's cd does not leak
expect 2 'git -C "$SOMEWHERE" push' "статично"
expect 2 "cd - && git push" "статично"
expect 2 "git -C /nonexistent-pr-self-review-dir push" "не git-репозиторій"
# the other worktree gets its own PASS stamp; the session one is now BLOCK
STAMP_WT="$OTHER" stamp PASS checks
stamp BLOCK full
expect 0 "git -C $OTHER push -u origin HEAD"
expect 0 "git -C $OTHER push -u origin HEAD 2>&1 | tail -25"
expect 0 "cd $OTHER && git push"
expect 2 "cd $OTHER && gh pr create --fill" "рівень"
expect 2 "git push" "BLOCK"
expect 2 "git -C $OTHER push && git push" "BLOCK"

[ "$fails" = 0 ] || { echo "$fails case(s) failed"; exit 1; }
echo "all hook cases passed"
