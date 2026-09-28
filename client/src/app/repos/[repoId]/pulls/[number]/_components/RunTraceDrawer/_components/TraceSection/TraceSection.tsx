/* TraceSection — collapsible titled section used throughout the trace tab. */
"use client";

import React from "react";
import { Icon, Disclosure, DisclosureChevron } from "@devdigest/ui";
import { s } from "../../styles";

export function TraceSection({
  icon,
  title,
  right,
  children,
  defaultOpen = true,
}: {
  icon: "Settings" | "Gauge" | "FileText" | "Wrench" | "Code" | "AlertOctagon";
  title: string;
  /** Non-interactive header adornment (a count badge) — rendered inside the toggle. */
  right?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const I = Icon[icon];
  return (
    <Disclosure
      defaultOpen={defaultOpen}
      style={s.section}
      headerStyle={s.sectionHead}
      header={(open) => (
        <>
          <I size={15} style={s.sectionIcon} />
          <span style={s.sectionTitle}>{title}</span>
          {right}
          <DisclosureChevron open={open} size={15} />
        </>
      )}
    >
      <div style={s.sectionBody}>{children}</div>
    </Disclosure>
  );
}
