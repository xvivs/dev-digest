#!/usr/bin/env bash
# Deterministic half of the golden fixtures: routing (collect) and checks.
# No LLM. For the full run see README.md.
#
#   bash run-fixtures.sh [--keep] [fixture ...]
#
# --keep leaves the last fixture's worktree in place and prints its path and
# runDir, so the full skill can be run against it.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_worktree.sh"

KEEP=0
if [ "${1:-}" = "--keep" ]; then KEEP=1; shift; fi
FIXTURES=("$@")
[ ${#FIXTURES[@]} -gt 0 ] || FIXTURES=($(ls "$HERE/fixtures"))

fails=0
for f in "${FIXTURES[@]}"; do
  dir="$HERE/fixtures/$f"
  [ -d "$dir" ] || { echo "no fixture $f"; exit 1; }
  make_eval_worktree
  [ "$KEEP" = 1 ] || trap drop_eval_worktree EXIT
  cp -R "$dir/files/." "$EVAL_WT/"
  eval_commit "eval: $f"

  collect="$(cd "$EVAL_WT" && node "$SKILL_SCRIPTS/self-review.mjs" collect --no-fetch --base "$EVAL_BASE")"
  run_dir="$(node -e 'console.log(JSON.parse(process.argv[1]).runDir)' "$collect")"
  checks="$(cd "$EVAL_WT" && node "$SKILL_SCRIPTS/self-review.mjs" check --run "$run_dir")"

  if node - "$dir/expected.json" "$collect" "$checks" <<'NODE'
const [expPath, collectRaw, checksRaw] = process.argv.slice(2);
const exp = JSON.parse(require('fs').readFileSync(expPath, 'utf8'));
const collect = JSON.parse(collectRaw);
const checks = JSON.parse(checksRaw);
const failedIds = new Set(checks.failed.map((c) => c.id));
const passedIds = new Set(checks.passed);
const problems = [];
for (const id of exp.deterministic.mustFail) if (!failedIds.has(id)) problems.push(`check ${id} must fail`);
for (const id of exp.deterministic.mustPass) if (!passedIds.has(id)) problems.push(`check ${id} must pass (failed: ${failedIds.has(id)}, skipped: ${checks.skipped.join('; ') || '-'})`);
const unexpected = checks.failed.filter((c) => c.severity === 'CRITICAL' && !exp.deterministic.mustFail.includes(c.id));
for (const c of unexpected) problems.push(`unexpected CRITICAL check failure ${c.id}`);
for (const lf of exp.lensFindings) {
  const lens = collect.lensesToRun[lf.lens];
  if (!lens) problems.push(`lens ${lf.lens} not routed`);
  else if (!lens.files.includes(lf.file)) problems.push(`${lf.file} not routed to ${lf.lens}`);
}
if (problems.length) { console.log(problems.map((p) => '    ' + p).join('\n')); process.exit(1); }
console.log(`    lenses: ${Object.keys(collect.lensesToRun).join(', ') || '-'}; failed checks: ${[...failedIds].join(', ') || '-'}`);
NODE
  then echo "ok   $f"; else echo "FAIL $f"; fails=$((fails + 1)); fi

  if [ "$KEEP" = 1 ]; then
    echo "     worktree: $EVAL_WT"
    echo "     runDir:   $run_dir"
    EVAL_WT=""
  else
    drop_eval_worktree
    trap - EXIT
  fi
done
[ "$fails" = 0 ] || { echo "$fails fixture(s) failed"; exit 1; }
