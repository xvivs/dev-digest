/* Agent findings inside the DiffViewer (Files changed tab).
   Pure helpers (active filter, per-file selection, line marks) + the API shape
   the viewer needs. Unlike comments.ts this file imports a React TYPE (the card
   slot component), nothing at runtime. The card itself is injected by the route
   (the viewer must not import a route's _components). */
import type React from "react";
import { SEVERITY_RANK } from "@devdigest/ui";
import type { FindingActionKind, FindingRecord } from "@devdigest/shared";
import type { Line } from "./helpers";
import { lineKey } from "./comments";

export interface DiffFindingCardProps {
  finding: FindingRecord;
  onAction: (action: FindingActionKind) => void;
  pending: boolean;
}

/** What the viewer needs to show agent findings inline. */
export interface DiffFindingApi {
  /** Already filtered to the latest review per agent. */
  findings: FindingRecord[];
  /** When false, cards are hidden (stripes, labels and dots stay). */
  show: boolean;
  Card: React.ComponentType<DiffFindingCardProps>;
  onAction: (finding: FindingRecord, action: FindingActionKind) => void;
  pendingId: string | null;
}

/** A dismissed finding still renders (muted) but no longer counts or marks lines. */
export function isActiveFinding(f: FindingRecord): boolean {
  return f.dismissed_at == null;
}

/** The line key a finding's card hangs under: `RIGHT:<start_line>`. */
export function findingKey(f: FindingRecord): string | null {
  return lineKey("RIGHT", f.start_line);
}

/** Findings whose `file` is exactly `path` (case-sensitive, like git). */
export function findingsForFile(findings: readonly FindingRecord[], path: string): FindingRecord[] {
  return findings.filter((f) => f.file === path);
}

export interface LineMark {
  severity: FindingRecord["severity"];
  /** True on the line whose key is the finding's `RIGHT:start_line`. */
  isStart: boolean;
  /** Title of the finding that won the line (the stripe tooltip). */
  title: string;
}

/**
 * Stripe data per rendered RIGHT line (add or ctx) covered by an active
 * finding's `[start_line, max(start_line, end_line)]`. On overlap the worst
 * severity wins. Keyed by `RIGHT:<newNo>`.
 */
export function lineMarks(lines: readonly Line[], findings: readonly FindingRecord[]): Map<string, LineMark> {
  const marks = new Map<string, LineMark>();
  const active = findings.filter(isActiveFinding);
  if (active.length === 0) return marks;
  for (const ln of lines) {
    if ((ln.kind !== "add" && ln.kind !== "ctx") || ln.newNo == null) continue;
    const no = ln.newNo;
    let winner: FindingRecord | null = null;
    let isStart = false;
    for (const f of active) {
      if (no < f.start_line || no > Math.max(f.start_line, f.end_line)) continue;
      if (no === f.start_line) isStart = true;
      if (!winner || SEVERITY_RANK[f.severity] < SEVERITY_RANK[winner.severity]) winner = f;
    }
    if (winner) {
      marks.set(`RIGHT:${no}`, { severity: winner.severity, isStart, title: winner.title });
    }
  }
  return marks;
}
