import { diffLines } from "diff";
import type { SkillType } from "@devdigest/shared";

/** One rendered line of a body diff. Line numbers are 1-based, per side. */
export interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

/** What a version is compared with: the snapshot before it, or the skill as it is now. */
export type CompareMode = "prev" | "current";

/** The versioned metadata of one side. `null` = a legacy snapshot that never stored the field. */
export interface VersionMeta {
  name: string | null;
  description: string | null;
  type: SkillType | null;
}

export type MetadataField = keyof VersionMeta;

export interface MetadataChange {
  field: MetadataField;
  from: string;
  to: string;
}

const METADATA_FIELDS: readonly MetadataField[] = ["name", "description", "type"];

/** A jsdiff chunk's value → its lines. A trailing "\n" ends the last line, it does not start a new one. */
function splitChunk(value: string): string[] {
  const lines = value.split("\n");
  if (value.endsWith("\n")) lines.pop();
  return lines;
}

/** Line diff of two bodies, `oldBody` → `newBody`. */
export function diffBodies(oldBody: string, newBody: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const chunk of diffLines(oldBody, newBody)) {
    for (const text of splitChunk(chunk.value)) {
      if (chunk.added) out.push({ kind: "add", text, oldNo: null, newNo: ++newNo });
      else if (chunk.removed) out.push({ kind: "del", text, oldNo: ++oldNo, newNo: null });
      else out.push({ kind: "ctx", text, oldNo: ++oldNo, newNo: ++newNo });
    }
  }
  return out;
}

export function diffStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    else if (l.kind === "del") removed++;
  }
  return { added, removed };
}

/**
 * Metadata that differs between `base` and `target`, in a fixed field order.
 * A field null on either side (a snapshot from before the all-field migration)
 * is unknown, not "changed", so it is skipped.
 */
export function metadataChanges(base: VersionMeta, target: VersionMeta): MetadataChange[] {
  const changes: MetadataChange[] = [];
  for (const field of METADATA_FIELDS) {
    const from = base[field];
    const to = target[field];
    if (from == null || to == null || from === to) continue;
    changes.push({ field, from, to });
  }
  return changes;
}

/**
 * Which comparisons make sense for `version`:
 * - vs prev needs a snapshot of version − 1 (never for v1, never across a gap);
 * - vs current is pointless for the current version itself.
 */
export function compareAvailability(
  version: number,
  currentVersion: number,
  hasPrevSnapshot: boolean,
): Record<CompareMode, boolean> {
  return { prev: version > 1 && hasPrevSnapshot, current: version !== currentVersion };
}

export function defaultCompareMode(avail: Record<CompareMode, boolean>): CompareMode | null {
  if (avail.prev) return "prev";
  if (avail.current) return "current";
  return null;
}
