"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { BriefFailureReason } from "@devdigest/shared";
import { BriefFailureAction } from "../BriefFailureAction";
import { s as shared } from "../../styles";
import { s } from "./styles";

/** Last-failure notice of a brief block: the reason text plus its recovery action. */
export function BriefFailureNotice({
  prId,
  reason,
  deriveLabel,
  busy,
  onDerive,
}: {
  prId: string;
  reason: BriefFailureReason;
  deriveLabel: string;
  busy: boolean;
  onDerive: () => void;
}) {
  const t = useTranslations("brief");
  return (
    <div style={shared.notice} role="status">
      <Icon.AlertTriangle size={15} aria-hidden="true" />
      <span style={s.grow}>{t(`failure.${reason}`)}</span>
      <BriefFailureAction prId={prId} reason={reason} deriveLabel={deriveLabel} busy={busy} onDerive={onDerive} />
    </div>
  );
}
