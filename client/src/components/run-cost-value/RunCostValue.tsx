/**
 * RunCostValue — the one place that knows how to render a run's cost, on any
 * of the three surfaces (timeline row, sidebar Stat card, PR list column).
 *
 * Deliberately a bare <span title=…>: no fontSize/color/padding of its own, so
 * it inherits the surrounding typography instead of imposing its own — the
 * same component drops into an 11px timeline row and a 16px Stat card without
 * changes. The native `title` attribute is the tooltip mechanism everywhere;
 * surfaces never know a tooltip is involved (precedent: RunReviewDropdown.tsx).
 */
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { CostSource, CostMissingReason } from "@devdigest/shared";
import { formatCost, exactCost } from "./helpers";

export function RunCostValue({
  usd,
  source,
  missingReason,
  style,
}: {
  /** The run's cost in USD. Null/undefined when no cost is available (yet, or ever). */
  usd: number | null | undefined;
  /** 'provider' = billed amount from the LLM provider; 'estimated' = computed from the price book. Ignored when `usd` is null. */
  source?: CostSource | null;
  /** Why `usd` is null — surfaced in the tooltip. Ignored when `usd` is set. */
  missingReason?: CostMissingReason | null;
  style?: CSSProperties;
}) {
  const t = useTranslations("cost");

  if (usd == null) {
    const reason = missingReason ?? "default";
    return (
      <span title={t(`missing.${reason}`)} style={style}>
        —
      </span>
    );
  }

  const exact = exactCost(usd);

  if (source === "estimated") {
    return (
      <span title={t("estimated", { value: exact })} style={style}>
        ~{formatCost(usd)}
      </span>
    );
  }

  return (
    <span title={t("exact", { value: exact })} style={style}>
      {formatCost(usd)}
    </span>
  );
}
