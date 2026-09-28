#!/usr/bin/env bash
# Allow/block matrix for gate-hook.mjs in a throwaway worktree. No LLM.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_worktree.sh"
HOOK="$SKILL_SCRIPTS/gate-hook.mjs"

make_eval_worktree
trap drop_eval_worktree EXIT
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

stamp() { # $1 = verdict, $2 = level ("checks" | "full" | omitted = legacy, no level field)
  local verdict="$1" level="${2:-}" level_line=""
  if [ -n "$level" ]; then level_line="s.level = '$level';"; fi
  (cd "$EVAL_WT" && node --input-type=module -e "
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

[ "$fails" = 0 ] || { echo "$fails case(s) failed"; exit 1; }
echo "all hook cases passed"
