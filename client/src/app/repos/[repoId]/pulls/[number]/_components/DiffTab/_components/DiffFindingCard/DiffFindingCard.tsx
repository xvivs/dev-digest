/* DiffFindingCard — the Agent runs FindingCard, expanded, for the diff viewer's
   card slot. A module-level component (not a render function) so hooks and
   reconciliation behave. */
"use client";

import React from "react";
import type { DiffFindingCardProps } from "@/components/diff-viewer";
import { FindingCard } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingCard";
import { DiffNavContext } from "./context";

export function DiffFindingCard({ finding, onAction, pending }: DiffFindingCardProps) {
  const nav = React.useContext(DiffNavContext);
  // In the diff: the path scrolls to the file. Not in the diff: it links to GitHub.
  const inDiff = nav?.paths.has(finding.file) ?? false;
  return (
    <FindingCard
      f={finding}
      defaultExpanded
      onAction={onAction}
      pending={pending}
      repoFullName={nav?.repoFullName}
      headSha={nav?.headSha}
      onOpenFile={inDiff && nav ? () => nav.openFile(finding.file, finding.start_line) : undefined}
    />
  );
}
