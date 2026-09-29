import type { IconName } from "@devdigest/ui";
import type { ImpactVerdict } from "@devdigest/shared";

/** Colour + glyph per verdict. The glyph and label carry the meaning; colour only reinforces it. */
export const VERDICT_LOOK: Readonly<Record<ImpactVerdict, { color: string; bg: string; icon: IconName }>> = {
  helps: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
  neutral: { color: "var(--text-secondary)", bg: "var(--bg-hover)", icon: "Slash" },
  hurts: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "TrendingDown" },
  indicative: { color: "var(--info)", bg: "var(--info-bg)", icon: "Info" },
  unknown: { color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "FlaskConical" },
};
