"use client";

import React from "react";
import { BriefSection } from "./_components/BriefSection";
import { IntentCard } from "./_components/IntentCard";
import { RiskAreas } from "./_components/RiskAreas";
import { BlastRadiusCard } from "./_components/BlastRadiusCard";
import { PriorPrs } from "./_components/PriorPrs";
import { s } from "./styles";

export interface OverviewTabProps {
  prId: string;
}

export function OverviewTab({ prId }: OverviewTabProps) {
  return (
    <div style={s.root}>
      <BriefSection prId={prId} />
      <div style={s.grid}>
        <section style={s.card}>
          <IntentCard prId={prId} />
          <hr style={s.divider} />
          <RiskAreas prId={prId} />
        </section>
        <section style={s.card}>
          <BlastRadiusCard prId={prId} />
          <hr style={s.divider} />
          <PriorPrs prId={prId} />
        </section>
      </div>
    </div>
  );
}
