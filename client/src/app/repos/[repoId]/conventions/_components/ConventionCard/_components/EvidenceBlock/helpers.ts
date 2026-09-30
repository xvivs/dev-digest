import type { ConventionEvidence } from "@devdigest/shared";

/** `path:start-end`, the citation shown on the evidence header and used in labels. */
export function evidenceLocation(ev: ConventionEvidence): string {
  return `${ev.path}:${ev.line_start}-${ev.line_end}`;
}
