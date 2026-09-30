"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type { PrDetail } from "@/lib/types";
import { BriefSection } from "./_components/BriefSection";
import { IntentCard } from "./_components/IntentCard";
import { RiskAreas } from "./_components/RiskAreas";
import { BlastRadiusCard } from "./_components/BlastRadiusCard";
import { PriorPrs } from "./_components/PriorPrs";
import { s } from "./styles";

export interface OverviewTabProps {
  prId: string;
  pr: Pick<PrDetail, "body">;
}

export function OverviewTab({ prId, pr }: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <div style={s.root}>
      <BriefSection prId={prId} />
      <div style={s.grid}>
        <div style={s.col}>
          <IntentCard prId={prId} />
          <RiskAreas prId={prId} />
        </div>
        <div style={s.col}>
          <BlastRadiusCard prId={prId} />
          <PriorPrs prId={prId} />
        </div>
      </div>
      {pr.body && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.description")}</SectionLabel>
          <div style={s.descriptionBox}>{pr.body}</div>
        </section>
      )}
    </div>
  );
}
