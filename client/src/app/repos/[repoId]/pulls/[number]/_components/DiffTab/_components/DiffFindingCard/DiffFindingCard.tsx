/* DiffFindingCard — the Agent runs FindingCard, expanded, for the diff viewer's
   card slot. A module-level component (not a render function) so hooks and
   reconciliation behave. */
"use client";

import React from "react";
import type { DiffFindingCardProps } from "@/components/diff-viewer";
import { FindingCard } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingCard";

export function DiffFindingCard({ finding, onAction, pending }: DiffFindingCardProps) {
  return <FindingCard f={finding} defaultExpanded onAction={onAction} pending={pending} />;
}
