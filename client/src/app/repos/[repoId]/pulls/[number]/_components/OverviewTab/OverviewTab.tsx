"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { s } from "./styles";

export interface OverviewTabProps {
  prBody: string | null | undefined;
}

export function OverviewTab({ prBody }: OverviewTabProps) {
  const t = useTranslations("prReview");
  if (!prBody) return null;
  return (
    <section>
      <SectionLabel icon="MessageSquare">{t("overview.description")}</SectionLabel>
      <div style={s.descriptionBox}>{prBody}</div>
    </section>
  );
}
