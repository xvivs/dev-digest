# ADR 0016 — Skill versions are append-only snapshots of every field

**Status:** accepted; decision 4 amended 2026-09-29 (see Update)
**Date:** 2026-09-29
**Interprets:** ADR 0012, decision 4 (vetting reset on edit)

## Context

The Versions tab in `SkillEditor.tsx:30` is a placeholder. Two gaps in the server block a real history:

1. `SkillsRepository.insert` (`server/src/modules/skills/repository.ts:100`) writes no snapshot for v1. The v1 body is lost after the first edit. `update` already snapshots the state at vN (`repository.ts:147-152`), and that semantics is correct.
2. `service.ts:79` bumps the version only when the body changes (`bumpVersion: bodyChanged`). A rename or a description or type change leaves no trace.

Restore raises a second question. `update` has no version guard (`repository.ts:124-161`), so a restore built on it can overwrite a concurrent edit. Separately, ADR 0012 says editing the body of an imported skill resets `needs_vetting`, but is silent about what a restore of an old body of a `manual` skill should do.

## Decision

1. **Snapshot every field.** `skill_versions` gains `name, description, type, change_note` next to `body`. `insert` writes v1 in the same transaction as the skill row.
2. **Bump on any content change.** The version bumps when any of `name`, `description`, `type`, `body` changes. Toggling `enabled` never bumps.
3. **Append-only.** History is never rewritten. Restoring vN creates vN+1 with `change_note = "Restored from vN"`. `PUT /skills/:id` accepts an optional `change_note`.
4. **Two restore paths** (amended: Edit removed, see Update), chosen in a popup (Edit / Restore / Cancel, ADR 0009 focus trap):
   - **Edit** opens the vN snapshot in Config as an unsaved draft (`skillHref(id,'config')&fromVersion=N`). Nothing is written until Save, which is a normal `PUT` with the default note `Restored from vN (edited)`.
   - **Restore** calls `POST /skills/:id/versions/:v/restore {expected_version}`. A new store method guards on `version`, modelled on `vet` (`repository.ts:169-189`). A stale `expected_version` returns 409 `SkillVersionStaleError`. The guard also applies in the no-op branch. An identical body returns 200 with no new version.
5. **Read endpoints.** `GET /skills/:id/versions` lists versions without bodies. `GET /skills/:id/versions/:v` returns one: non-numeric `v` gives 422, unknown gives 404, as in `agents/routes.ts:137,145`.
6. **Vetting on restore.** Restore goes through `resolveVettingOnBodyEdit` and `assertEnableAllowed` (`skills/domain.ts:111`), the same path as an edit. The body size limit from ADR 0012 applies too.
7. **Vetting is reset only for `imported` skills.** This is our reading of ADR 0012 decision 4: a `manual` skill is trusted on save, so a new body, whether typed or restored, needs no vetting. Tests cover every `source`.
8. **Diff.** Inline, vN against vN−1, with a "vs current" toggle. Changed metadata shows above the body diff as `field: old → new`. Markers are `+`/`−` with `aria-label`, so meaning does not rely on colour.

## Consequences

### What this enables

- A full audit trail for name, description, type and body, with a one-click way back.
- Restore is safe against concurrent edits: the guard turns a lost update into a 409, which the UI shows as "skill changed, reload" (ADR 0011).
- A restore is visible in history as a normal version, so no history is ever removed.

### What this costs

- **Lost history.** Bodies of versions before this change were never stored. The UI shows "vN body unavailable" for them. Backfill can only snapshot the current body (`drizzle-kit generate --custom`, no hand-written migrations).
- Versions now grow on metadata edits, so the version number is no longer a proxy for "the prompt changed". Eval staleness keys on `prompt_sha256` instead (ADR 0017).
- The `vet` guard at `repository.ts:169` now returns 409 when a skill is renamed during vetting. This is correct, and it needs a test.
- Manual skills can be restored to an unvetted-by-anyone body. Accepted: `manual` is trusted by definition in ADR 0012.

### What this forbids

- Editing or deleting a snapshot row.
- A restore that skips the `expected_version` guard.
- Restoring by mutating the current row in place without a new version.
- Bypassing `assertEnableAllowed` on restore.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Version only on body change (status quo) | No migration | Renames and type changes are unrecoverable; history is incomplete |
| **Snapshot all fields, bump on any content change (chosen)** | Complete history; simple mental model | Migration; version number no longer tracks prompt changes |
| Restore by rewinding (delete newer versions) | Linear history | Destroys audit trail; unsafe under concurrency |
| Restore as `PUT` only (Edit path only) | One code path | No guard against concurrent edits; two clicks to recover |
| **Two paths: Edit draft and guarded Restore (chosen)** | Fast recovery and safe tweak-then-save | Two flows to test and explain |
| Reset vetting on every edit, all sources | Uniform, strictest | Friction for trusted `manual` skills; contradicts ADR 0012 tiers |

## Update 2026-09-29: Restore is the only path

The Edit path from decision 4 is gone. The popup is now a confirmation
dialog: `Restore vN?`, one line saying it creates vN+1 with the content of vN,
and a footer with Cancel and `Restore as vN+1`. Restore takes initial focus.
The client code behind Edit (`?fromVersion=N`, the Config draft seeded from a
snapshot, the default note `Restored from vN (edited)`) was deleted with it.

Why: two paths meant two flows to explain in one small popup, and the popup
read as a three-way choice where Cancel looked like an action. Tweaking an old
version is still possible in two steps: restore it, then edit the new version
in Config.

What still holds from decision 4: the guarded `POST
/skills/:id/versions/:v/restore {expected_version}`, the 409
`SkillVersionStaleError`, the guard on the no-op branch, and the focus trap
from ADR 0009, which the popup gets from `Modal`. The no-op branch compares
every snapshotted field, not only the body.

This changes the Alternatives table. "Two paths: Edit draft and guarded
Restore" is no longer the chosen option. The chosen option is guarded Restore
alone. "Restore as `PUT` only" stays rejected: it has no guard against
concurrent edits.

The `file:line` references in Context and Decision describe the code as it was
when this ADR was written. They have drifted since and are kept as a historical
record. Search by symbol (`snapshotOf`, `write`, `vet`, `assertEnableAllowed`)
instead of by line.
