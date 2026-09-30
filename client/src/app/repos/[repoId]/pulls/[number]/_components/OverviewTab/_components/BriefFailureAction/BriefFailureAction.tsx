"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { BriefFailureReason } from "@devdigest/shared";
import { useRefreshPullForBrief } from "@/lib/hooks";

/**
 * Action next to a failure notice. `head_moved` means the persisted head is
 * behind GitHub, so a re-derive would fail again: refresh the PR instead.
 * Every other reason re-runs the derivation.
 */
export function BriefFailureAction({
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
  const refreshPull = useRefreshPullForBrief(prId);
  if (reason === "head_moved") {
    return (
      <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => void refreshPull()}>
        {t("failure.refreshPr")}
      </Button>
    );
  }
  return (
    <Button kind="secondary" size="sm" icon="Sparkles" loading={busy} disabled={busy} onClick={onDerive}>
      {busy ? t("deriving") : deriveLabel}
    </Button>
  );
}
