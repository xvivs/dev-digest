/* UnmatchedFindings — end-of-file block for findings that match no rendered
   line of their file (deleted line, outside the patch, binary / no patch). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import type { DiffFindingApi } from "../findings";
import { cs, unmatchedWrapFor } from "../styles";

export function UnmatchedFindings({
  findings,
  api,
  title,
  variant = "inFile",
}: {
  findings: FindingRecord[];
  api: DiffFindingApi;
  /** Overrides the default heading (findings on deleted / out-of-patch lines). */
  title?: string;
  /** `standalone` drops the file-card indent (block sits directly in the page). */
  variant?: "inFile" | "standalone";
}) {
  const t = useTranslations("diffViewer");
  if (findings.length === 0) return null;
  const { Card } = api;
  return (
    <div style={unmatchedWrapFor(variant)}>
      <span style={cs.outdatedTitle}>{title ?? t("unmatchedFindingsTitle", { count: findings.length })}</span>
      {findings.map((f) => (
        <Card
          key={f.id}
          finding={f}
          onAction={(action) => api.onAction(f, action)}
          pending={api.pendingId === f.id}
        />
      ))}
    </div>
  );
}
