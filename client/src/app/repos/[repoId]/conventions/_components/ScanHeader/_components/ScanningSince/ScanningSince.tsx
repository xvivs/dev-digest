/* ScanningSince — "Scanning… started X ago" that keeps counting while a scan runs.
   It is its own component so the clock (`useNow` with an interval) exists only
   while a scan is running and each tick re-renders this one text node, not the
   header or the page. `now` comes from `useNow`, so the text is never stale. */
"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { SCANNING_TICK_MS } from "../../constants";
import { isJustNow } from "../../helpers";

export function ScanningSince({ since }: { /** ISO time the scan started. */ since: string }) {
  const t = useTranslations("conventions");
  const format = useFormatter();
  const now = useNow({ updateInterval: SCANNING_TICK_MS });
  const at = new Date(since);
  const when = isJustNow(at, now) ? t("header.justNow") : format.relativeTime(at, now);
  return <>{t("header.scanning", { when })}</>;
}
