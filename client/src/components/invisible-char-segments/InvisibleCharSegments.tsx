/* InvisibleCharSegments — renders a skill body split into printable runs and
   flagged invisible/bidi characters (see `splitInvisibleChars`, ADR 0012 /
   SPEC-02 AC-10). Shared by SkillBodyPreview's Source view and VetSkillModal's
   raw-source pane so both mark invisible characters identically. */
import React from "react";
import type { SourceSegment } from "@/app/skills/helpers";
import { s } from "./styles";

export function InvisibleCharSegments({ segments }: { segments: SourceSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.invisibleLabel ? (
          <mark key={i} style={s.invisibleMark} title={seg.invisibleLabel}>
            [{seg.invisibleLabel}]
          </mark>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
    </>
  );
}
