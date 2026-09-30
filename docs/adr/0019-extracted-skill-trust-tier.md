# ADR 0019 — Extracted skills are vetted by the act of creating them

**Status:** accepted · extends ADR 0012 §4
**Date:** 2026-09-29

## Context

ADR 0012 gave skills two trust tiers. A `manual` skill is trusted on save. Any other
source is forced to `enabled = false` and `needs_vetting = true`, and a person reads it
and calls `POST /skills/:id/vet`. `applyImportPolicy`
(`server/src/modules/skills/domain.ts:94`) encodes this: every non-manual source becomes
disabled and unvetted.

L02 adds a third way to make a skill. The conventions module scans a repo, proposes
conventions, and the user picks accepted ones and clicks "Create" in a modal that shows the
full skill body (`specs/02-conventions.md`, D10). The body is built from code someone else
wrote, so it is not manual. But the user has just read every line of it. Routing it through
the imported path would force a second step, "Vet", on a body the user approved seconds
earlier.

We need a tier for skills born from conventions, and a rule for what vets them.

## Decision

1. **New tier `extracted`.** Skills created from conventions carry `source = 'extracted'`.
   Pressing "Create" in the modal is the vetting act: the server stores
   `needs_vetting = false`, `vetted_body_hash = sha256(body)`, and `enabled` from the
   modal's toggle.
2. **Explicit source policy.** `applyImportPolicy` is replaced by `applySourcePolicy` in
   `server/src/modules/_shared/skill-rules.ts`. It has one explicit branch per source, so a
   new source cannot inherit a tier by falling through.
3. **Body hygiene.** The rules are the same as ADR 0012 §5, enforced on the server:
   invisible or bidi characters return 422. Snippets in the body are capped at 12 lines and
   sit in a fence longer than any run of backticks inside the snippet.
4. **Edits reset vetting.** Editing the body of an `extracted` skill sets
   `needs_vetting = true` and clears the vetted hash, as for `imported`
   (`resolveVettingOnBodyEdit`, `domain.ts:111`). The existing hash gate in the repository
   (`repository.ts:237`, `source !== 'manual'`) already covers the new source.
5. **Creation path.** Public `POST /skills` still accepts only `manual` and `imported`.
   Only the conventions module creates `extracted` skills.
6. **Residual risk (V20).** Natural-language injection from repo code can sit inside an
   auto-vetted body, and a person can miss it. Mitigations: the user sees the full raw body
   with markers for invisible characters before saving; snippets are capped; hygiene applies;
   `INJECTION_GUARD` stays last in the system message (ADR 0012 §1–2).

## Consequences

### What this enables

- One click turns accepted conventions into a working skill, with no second vetting step.
- The prompt gate is unchanged: a skill reaches the model only when `skill.enabled &&
  link.enabled && !needs_vetting`, and the hash must match the current body.
- Adding a source later forces a decision, because `applySourcePolicy` has no default branch.

### What this costs

- Vetting quality equals reading quality. A user who skims the modal auto-vets hostile text.
- Code in the repo can steer the agent through prose in a snippet. Hygiene and the cap catch
  hidden characters and bulk, not persuasion.
- The tier logic now lives in `_shared/skill-rules.ts`, and the skills module and the
  conventions module both depend on it.

### What this forbids

- Creating an `extracted` skill through public `POST /skills`.
- Trusting `enabled`, `needs_vetting` or `vetted_body_hash` from the client for this source.
- Storing an `extracted` skill body that failed hygiene, or a snippet over 12 lines.
- Keeping a vet after the body changed.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Treat as `imported`: disabled, separate Vet step | No new tier; the strictest default | The user already read the body, so Vet adds friction and no information; users would rubber-stamp it |
| Treat as `manual`: trusted on save | Simplest | Skips the hash gate and the edit reset, so a later edit ships unvetted; conflates repo-derived text with text the user wrote |
| **`extracted` tier: Create is the vetting act (chosen)** | Matches what the user actually did; keeps hash gate and edit reset | Auto-vetting depends on the user reading; V20 stays open |
