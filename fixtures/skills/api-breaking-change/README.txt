This archive is a fixture for testing DevDigest's skill import path
(specs/02-skills.md, Import section, AC-20 through AC-24).

Contents:
  SKILL.md        - the skill itself: frontmatter (name, description, type)
                    plus the body that becomes the skill's `body` column.
  scripts/check.sh - deliberately NOT executed by anything. Its only job is
                    to prove the point: if DevDigest ever ran it, it would
                    leave /tmp/devdigest-skill-executed.marker on disk.
  README.txt      - this file. Also not executed; also not SKILL.md, so the
                    import path should list it as a skipped, unread entry.

Per AC-21, the client locates SKILL.md at the archive root (or one level
down), lists every other entry as "skipped, not executed", and flags entries
under scripts/ or with an executable extension (.sh here). Nothing in this
archive should ever run — reading SKILL.md as UTF-8 text is the only thing
the import path is allowed to do with any of it.
