#!/usr/bin/env bash
# Incremental full review and per-lens cache key (ADR 0015). No LLM.
#
# Commit 1 adds the `clean` fixture file, a synthetic full PASS stamp is written
# for it (as hook-cases.sh does), commit 2 adds the `core-io` file. A full
# `collect` must then route only commit 2's file to the lenses.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/_worktree.sh"

make_eval_worktree
trap drop_eval_worktree EXIT
STATE="$EVAL_WT/.devdigest/self-review"
mkdir -p "$STATE"

cp -R "$HERE/fixtures/clean/files/." "$EVAL_WT/"
eval_commit "eval: incremental step 1"
FIRST="$(git -C "$EVAL_WT" rev-parse HEAD)"
BRANCH="$(git -C "$EVAL_WT" rev-parse --abbrev-ref HEAD)"

stamp() { # $1 = verdict, $2 = level, $3 = head
  node -e '
    const [dir, base, branch, verdict, level, head] = process.argv.slice(1);
    const hash = require("crypto").createHash("sha256").update(verdict + level + head).digest("hex");
    require("fs").writeFileSync(`${dir}/${hash}.json`, JSON.stringify({ diffHash: hash, base, branch, head, level, verdict, blocking: [], at: new Date().toISOString() }));
  ' "$STATE" "$EVAL_BASE" "$BRANCH" "$1" "$2" "$3"
}

cp -R "$HERE/fixtures/core-io/files/." "$EVAL_WT/"
eval_commit "eval: incremental step 2"

collect() { (cd "$EVAL_WT" && node "$SKILL_SCRIPTS/self-review.mjs" collect --no-fetch --base "$EVAL_BASE" "$@"); }
routed() { node -e 'const j=JSON.parse(process.argv[1]); console.log([...new Set(Object.values(j.lensesToRun).flatMap((l)=>l.files))].sort().join(","))' "$1"; }
inc() { node -e 'const j=JSON.parse(process.argv[1]); console.log(j.incremental ? j.incremental.fromHead : "-")' "$1"; }

fails=0
expect() { # $1 = name, $2 = actual, $3 = expected
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got '$2', want '$3'"; fails=$((fails + 1)); fi
}
BOTH="reviewer-core/src/eval-clamp.ts,reviewer-core/src/eval-io.ts"
ONLY_NEW="reviewer-core/src/eval-io.ts"

out="$(collect)"
expect "no stamp: full review" "$(routed "$out") $(inc "$out")" "$BOTH -"

stamp PASS checks "$FIRST"
out="$(collect)"
expect "checks-level PASS is not a base" "$(routed "$out") $(inc "$out")" "$BOTH -"

stamp BLOCK full "$FIRST"
out="$(collect)"
expect "full BLOCK is not a base" "$(routed "$out") $(inc "$out")" "$BOTH -"

stamp PASS full "$FIRST"
out="$(collect)"
expect "full PASS on ancestor: only the delta" "$(routed "$out") $(inc "$out")" "$ONLY_NEW $FIRST"

out="$(collect --no-incremental)"
expect "--no-incremental: full review" "$(routed "$out") $(inc "$out")" "$BOTH -"

out="$(collect --full)"
expect "--full: full review" "$(inc "$out")" "-"

stamp PASS full "0000000000000000000000000000000000000000"
out="$(collect)"
expect "unknown head is ignored" "$(inc "$out")" "$FIRST"

# B: one lens's block does not change another lens's prompt part.
node --input-type=module - "$SKILL_SCRIPTS/lib.mjs" "$HERE/../references/lens-prompts.md" <<'NODE' && echo "ok   per-lens prompt part" || { echo "FAIL per-lens prompt part"; exit 1; }
const [lib, promptsPath] = process.argv.slice(2);
const { lensPromptPart } = await import(lib);
const text = (await import('node:fs')).readFileSync(promptsPath, 'utf8');
const edited = text.replace('### `core-purity` (reviewer-core)\n', '### `core-purity` (reviewer-core)\nEDITED\n');
if (edited === text) throw new Error('core-purity heading not found');
const same = (lens) => lensPromptPart(text, lens) === lensPromptPart(edited, lens);
if (same('core-purity')) throw new Error('core-purity part did not change');
for (const lens of ['client-arch', 'client-tests', 'server-arch', 'server-tech', 'security', 'ts-advisory'])
  if (!same(lens)) throw new Error(`${lens} part changed`);
const shared = text.replace('ROLE\nYou are the', 'ROLE\nYou are EDITED the');
if (shared === text || lensPromptPart(shared, 'client-arch') === lensPromptPart(text, 'client-arch')) throw new Error('shared contract edit not seen');
NODE

[ "$fails" = 0 ] || { echo "$fails case(s) failed"; exit 1; }
