"use client";

import React from "react";
import { BriefSection } from "./_components/BriefSection";
import { IntentCard } from "./_components/IntentCard";
import { RiskAreas } from "./_components/RiskAreas";
import { BlastRadiusCard } from "./_components/BlastRadiusCard";
import { PriorPrs } from "./_components/PriorPrs";
import { PrepareOverview } from "./_components/PrepareOverview";
import { s } from "./styles";

export interface OverviewTabProps {
  prId: string;
  repoId: string;
  /** `owner/name`; null while the repo record is unknown (links fall back to plain text). */
  repoFullName: string | null;
}

export function OverviewTab({ prId, repoId, repoFullName }: OverviewTabProps) {
  return (
    <div style={s.root}>
      {/* The tab's header; `key` remounts it (fresh auto-continue intent) on a PR change. */}
      <PrepareOverview key={prId} prId={prId} />
      <BriefSection prId={prId} />
      <div style={s.grid}>
        <section style={s.card}>
          <IntentCard prId={prId} />
          <hr style={s.divider} />
          <RiskAreas prId={prId} />
        </section>
        <section style={s.card}>
          <BlastRadiusCard prId={prId} repoId={repoId} repoFullName={repoFullName} />
          <hr style={s.divider} />
          <PriorPrs prId={prId} />
        </section>
      </div>
    </div>
  );
}
