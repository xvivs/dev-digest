/* format-date.ts — the one date formatter for timestamps shown in lists and
   cards ("when did this run / comment happen"). Pure: no React, no next-intl. */

/**
 * The fields `Date#toLocaleString()` prints by default (numeric date + time).
 * Pass it to next-intl's `useFormatter().dateTime(date, WHEN_FORMAT)` to get
 * the same output with the app-wide locale and time zone.
 */
export const WHEN_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};

export interface FormatWhenOptions {
  /** BCP 47 locale. Omitted → the runtime's default locale. */
  locale?: string;
  /** IANA zone, e.g. "UTC" or "Europe/Kyiv". Omitted → the runtime's zone. */
  timeZone?: string;
}

/**
 * ISO timestamp → a localised date + time. An unparseable input comes back
 * unchanged, so a bad value is visible instead of rendering "Invalid Date".
 *
 * Hydration: with no `timeZone`, the result depends on where it runs. A
 * `"use client"` component is still rendered on the server first, so the
 * server's zone and the browser's zone can disagree and trigger a hydration
 * mismatch. Components rendered during SSR should either pass an explicit
 * `timeZone` (and `locale`) or format through next-intl's `useFormatter()`
 * with `WHEN_FORMAT`. The zero-option call matches the old inline copies in
 * ReviewRunAccordion and CommentCard exactly.
 */
export function formatWhen(iso: string, options: FormatWhenOptions = {}): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const { locale, timeZone } = options;
  return timeZone ? d.toLocaleString(locale, { ...WHEN_FORMAT, timeZone }) : d.toLocaleString(locale);
}
