/* ToolCallRow — one expandable tool-call line in the Tool calls section. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Collapse } from "@devdigest/ui";
import type { ToolCall } from "@devdigest/shared";
import { s } from "../../styles";

export function ToolCallRow({ tc }: { tc: ToolCall }) {
  const t = useTranslations("runs");
  const [open, setOpen] = React.useState(false);
  const bodyId = React.useId();
  return (
    <div style={s.toolRow}>
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
        style={s.toolHead}
      >
        <Icon.Wrench size={13} style={s.toolIcon} />
        <span className="mono" style={s.toolName}>
          {tc.tool}
          <span style={s.toolArgs}>({tc.args})</span>
        </span>
        <span style={s.toolMeta}>{tc.meta}</span>
        <span className="mono tnum" style={s.toolMs}>
          {tc.ms}ms
        </span>
      </div>
      <Collapse open={open} id={bodyId}>
        <div className="mono" style={s.toolDetail}>
          {t("trace.tools.args")}: {tc.args}
          <br />
          {t("trace.tools.result")}: {tc.meta ?? "—"} {t("trace.tools.previewTruncated")}
        </div>
      </Collapse>
    </div>
  );
}
