/* ToolCallRow — one expandable tool-call line in the Tool calls section. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Disclosure } from "@devdigest/ui";
import type { ToolCall } from "@devdigest/shared";
import { s } from "../../styles";

export function ToolCallRow({ tc }: { tc: ToolCall }) {
  const t = useTranslations("runs");
  return (
    <Disclosure
      style={s.toolRow}
      headerStyle={s.toolHead}
      header={
        <>
          <Icon.Wrench size={13} style={s.toolIcon} />
          <span className="mono" style={s.toolName}>
            {tc.tool}
            <span style={s.toolArgs}>({tc.args})</span>
          </span>
          <span style={s.toolMeta}>{tc.meta}</span>
          <span className="mono tnum" style={s.toolMs}>
            {t("trace.tools.ms", { ms: String(tc.ms) })}
          </span>
        </>
      }
    >
      <div className="mono" style={s.toolDetail}>
        {t("trace.tools.args")}: {tc.args}
        <br />
        {t("trace.tools.result")}: {tc.meta ?? t("trace.empty")} {t("trace.tools.previewTruncated")}
      </div>
    </Disclosure>
  );
}
