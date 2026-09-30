/* UnmatchedFindings — end-of-file block for findings that match no rendered
   line of their file (deleted line, outside the patch, binary / no patch). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import type { DiffFindingApi } from "../findings";
import { cs } from "../styles";

export function UnmatchedFindings({
  findings,
  api,
}: {
  findings: FindingRecord[];
  api: DiffFindingApi;
}) {
  const t = useTranslations("diffViewer");
  if (findings.length === 0) return null;
  const { Card } = api;
  return (
    <div style={cs.outdatedWrap}>
      <span style={cs.outdatedTitle}>{t("unmatchedFindingsTitle", { count: findings.length })}</span>
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
