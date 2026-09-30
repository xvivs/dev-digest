/* VerdictBadge — one skill-impact verdict (ADR 0017) with an optional
   "stale" marker. Shared by the skill card (list) and the Stats tab's Impact
   card, so the two never disagree on how a verdict looks. */
"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { ImpactVerdict } from "@devdigest/shared";
import { VERDICT_LOOK } from "./constants";
import { s } from "./styles";

export function VerdictBadge({
  verdict,
  stale = false,
  title,
}: {
  verdict: ImpactVerdict;
  /** The skill's prompt or the carrier's version moved since the eval ran. */
  stale?: boolean;
  /** Tooltip on the verdict itself, e.g. which carrier produced it. */
  title?: string;
}) {
  const t = useTranslations("skills");
  const look = VERDICT_LOOK[verdict];
  return (
    <span style={s.wrap}>
      <span title={title}>
        <Badge color={look.color} bg={look.bg} icon={look.icon}>
          {t(`verdict.${verdict}`)}
        </Badge>
      </span>
      {stale && (
        <span title={t("verdict.staleTitle")}>
          <Badge color="var(--warn)" bg="var(--warn-bg)" icon="Clock">
            {t("verdict.stale")}
          </Badge>
        </span>
      )}
    </span>
  );
}
