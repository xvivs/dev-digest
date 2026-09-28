/* TraceSection — collapsible titled section used throughout the trace tab. */
"use client";

import React from "react";
import { Icon, Collapse } from "@devdigest/ui";
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
  right?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const bodyId = React.useId();
  const I = Icon[icon];
  return (
    <div style={s.section}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        style={s.sectionHead}
      >
        <I size={15} style={s.sectionIcon} />
        <span style={s.sectionTitle}>{title}</span>
        {right}
        <Icon.ChevronDown size={15} style={s.chevron(open)} />
      </div>
      <Collapse open={open} id={bodyId}>
        <div style={s.sectionBody}>{children}</div>
      </Collapse>
    </div>
  );
}
