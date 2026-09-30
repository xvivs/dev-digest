/* ScanAgo — the "detected … last scan X ago" / "last scan failed X ago" subtitle.
   Its own component so the clock (`useNow` with an interval) re-renders only this text node,
   not the header, and the label keeps aging after a scan finished. `now` comes from `useNow`,
   so render stays pure. */
"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { LAST_SCAN_TICK_MS } from "../../constants";
import { isJustNow } from "../../helpers";

export function ScanAgo({
  since,
  ...message
}: {
  /** ISO time the scan finished (or started, while it has no finish time). */
  since: string;
} & ({ kind: "detected"; sampleCount: number } | { kind: "failed" })) {
  const t = useTranslations("conventions");
  const format = useFormatter();
  const now = useNow({ updateInterval: LAST_SCAN_TICK_MS });
  const at = new Date(since);
  const when = isJustNow(at, now) ? t("header.justNow") : format.relativeTime(at, now);
  return <>{message.kind === "detected" ? t("header.detected", { count: message.sampleCount, when }) : t("header.failed", { when })}</>;
}
