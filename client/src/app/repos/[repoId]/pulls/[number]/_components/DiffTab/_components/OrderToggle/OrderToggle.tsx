/* OrderToggle — Smart order / Original order segmented control. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ORDER_MODES, type OrderMode } from "../../constants";
import { s, segmentFor } from "./styles";

const LABEL_KEY: Record<OrderMode, string> = {
  smart: "smartDiff.smartOrder",
  original: "smartDiff.originalOrder",
};

export function OrderToggle({
  mode,
  onChange,
  smartDisabled,
}: {
  mode: OrderMode;
  onChange: (mode: OrderMode) => void;
  /** The grouping request failed: only Original order is usable. */
  smartDisabled: boolean;
}) {
  const t = useTranslations("prReview");
  return (
    <div role="group" aria-label={t("smartDiff.orderLabel")} style={s.group}>
      {ORDER_MODES.map((m) => {
        const disabled = m === "smart" && smartDisabled;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            disabled={disabled}
            onClick={() => onChange(m)}
            style={segmentFor(mode === m, disabled)}
          >
            {t(LABEL_KEY[m])}
          </button>
        );
      })}
    </div>
  );
}
