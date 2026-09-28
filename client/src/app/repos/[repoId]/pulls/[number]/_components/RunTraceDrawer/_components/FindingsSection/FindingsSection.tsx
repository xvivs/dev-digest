/* FindingsSection — the persisted findings of THIS run (same data as the
   "Review runs" list), rendered inside a collapsible TraceSection. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { lineLabel } from "@/components/findings-popover";
import { s } from "../../styles";
import { TraceSection } from "../TraceSection";

export function FindingsSection({ findings }: { findings: FindingRecord[] }) {
  const t = useTranslations("runs");
  return (
    <TraceSection
      icon="AlertOctagon"
      title={t("trace.findings")}
      right={<Badge color="var(--text-muted)">{findings.length}</Badge>}
    >
      {findings.length === 0 ? (
        <span style={s.noToolCalls}>{t("trace.noFindings")}</span>
      ) : (
        <div style={s.findingList}>
          {findings.map((f) => (
            <div key={f.id} style={s.finding}>
              <div style={s.findingHead}>
                <Badge color={SEV[f.severity].c} bg="transparent">
                  {f.severity}
                </Badge>
                <span style={s.findingTitle}>{f.title}</span>
              </div>
              <div className="mono" style={s.findingLocation}>
                {f.file}:{lineLabel(f)}
              </div>
              <div style={s.findingText}>{f.rationale}</div>
              {f.suggestion && (
                <div style={s.findingSuggestion}>
                  <strong>{t("trace.suggestedFix")} </strong>
                  {f.suggestion}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </TraceSection>
  );
}
