"use client";

import * as React from "react";
import { formatWhen } from "@/lib/format-date";

const subscribe = () => () => {};

/**
 * A timestamp formatted in the viewer's locale and time zone, without a
 * hydration mismatch. "use client" components still render on the server,
 * where the zone differs from the browser's: the server snapshot (and the
 * hydration pass) formats in UTC, then the client re-renders in local time.
 */
export function LocalTime({ iso, style }: { iso: string; style?: React.CSSProperties }) {
  const isClient = React.useSyncExternalStore(subscribe, () => true, () => false);
  const text = isClient ? formatWhen(iso) : formatWhen(iso, { locale: "en", timeZone: "UTC" });
  return (
    <time dateTime={iso} style={style}>
      {text}
    </time>
  );
}
