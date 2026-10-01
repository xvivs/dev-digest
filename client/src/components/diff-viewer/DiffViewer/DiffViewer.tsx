/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import type { DiffCommentApi } from "../comments";
import type { DiffFindingApi } from "../findings";
import type { RevealTarget } from "../helpers";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  findings,
  defaultOpenFor,
  reveal,
  onRevealConsumed,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  findings?: DiffFindingApi;
  /** Per-path initial open state; `undefined` keeps the size heuristic. */
  defaultOpenFor?: (path: string) => boolean | undefined;
  /** Opens and scrolls to this file/line (see FileCard). */
  reveal?: RevealTarget | null;
  /** Fired once the target card consumed `reveal` (opened + scrolled). */
  onRevealConsumed?: (reveal: RevealTarget) => void;
}) {
  const t = useTranslations("diffViewer");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f) => (
        <FileCard
          key={f.path}
          file={f}
          commenting={commenting}
          findingApi={findings}
          defaultOpen={defaultOpenFor?.(f.path)}
          reveal={reveal}
          onRevealConsumed={onRevealConsumed}
        />
      ))}
    </div>
  );
}
