# Skill import fixtures

Fixture data for the SPEC-02 skill-import path (`specs/02-skills.md`, Import
section, AC-20 through AC-24) and its final checklist item: *"An import went
through the preview, and the archive's script never ran (no marker file)."*

## `api-breaking-change/` + `api-breaking-change.zip`

`api-breaking-change/` is the source tree; `api-breaking-change.zip` is the
built archive an engineer would actually pick in the *Import from file*
dialog. Rebuild it after editing the source tree with:

```sh
cd fixtures/skills
zip -r api-breaking-change.zip api-breaking-change
```

(`zip -r` preserves the executable bit on `scripts/check.sh` — verify with
`unzip -Z api-breaking-change.zip` if you touch it; the entry should read
`-rwxr-xr-x`, not `-rw-r--r--`.)

Contents:

| Path | Role |
|---|---|
| `SKILL.md` | The real payload: YAML frontmatter (`name`, `description`, `type: rubric`) plus a directive markdown body on breaking API changes. This is the only file the import path is allowed to read. |
| `scripts/check.sh` | Bait. Named and placed exactly like a real repo convention (`scripts/`, executable), so an import path that "helpfully" runs setup scripts would run this one. It never should — see below. |
| `README.txt` | Filler. Not `SKILL.md`, so it must show up in the preview as a skipped, unread entry — proves the import path doesn't just grab "some markdown file" but specifically `SKILL.md` at the root or one level down. |

## Using it to prove non-execution

`scripts/check.sh` does exactly one thing if it ever runs:
`touch /tmp/devdigest-skill-executed.marker`. To use the fixture as the
checklist's proof:

1. Before importing: `test -e /tmp/devdigest-skill-executed.marker && echo
   STALE — remove it first` (a leftover marker from an earlier manual test
   would produce a false pass).
2. Go through the whole import flow — pick `api-breaking-change.zip`, read
   the preview (rendered + source, the trust banner, the skipped-entries
   list), and confirm.
3. After confirming: `test -e /tmp/devdigest-skill-executed.marker && echo
   FAIL — script ran || echo PASS — script never ran`.

The skill this produces is `source: 'imported'`, stored with `enabled =
false` and `needs_vetting = true` regardless of what the request said
(AC-23) — it will not reach any agent's prompt until someone opens *Review &
trust* on it.
