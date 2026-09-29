/* RunsSection — every job of the case in the shown suite: arm × repeat with
   result, matched must_find, unexpected findings, duration and cost; a failed
   run's error text sits under its row. */
"use client";

import React from "react";
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { EvalArm, EvalCaseArmDetail, EvalCaseRunDetail } from "@devdigest/shared";
import { RunCostValue } from "@/components/run-cost-value";
import { formatDuration } from "../../helpers";
import { Section } from "../Section";

const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12.5 };
const th: CSSProperties = { textAlign: "left", fontWeight: 600, color: "var(--text-muted)", padding: "0 8px 6px 0", fontSize: 12 };
const td: CSSProperties = { padding: "6px 8px 6px 0", borderTop: "1px solid var(--border)", fontVariantNumeric: "tabular-nums" };
const errorCell: CSSProperties = { padding: "0 0 8px", color: "var(--warn)", fontSize: 12, lineHeight: 1.5, overflowWrap: "anywhere" };
const RESULT_COLOR = { pass: "var(--ok)", fail: "var(--crit)", error: "var(--warn)", muted: "var(--text-muted)" } as const;

function resultKey(r: EvalCaseRunDetail): "pass" | "fail" | "error" | "queued" | "running" {
  if (r.status === "failed") return "error";
  if (r.status !== "done") return r.status;
  return r.pass ? "pass" : "fail";
}

export function RunsSection({ arms, expected }: { arms: Record<EvalArm, EvalCaseArmDetail>; expected: number }) {
  const t = useTranslations("eval");
  const rows = (["with", "without"] as const).flatMap((arm) => arms[arm].runs.map((r) => ({ arm, r })));
  return (
    <Section title={t("drawer.runs.title")}>
      {rows.length === 0 ? (
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("drawer.runs.none")}</span>
      ) : (
        <table style={table}>
          <thead>
            <tr>
              {(["arm", "repeat", "result", "matched", "unexpected", "duration", "cost"] as const).map((k) => (
                <th key={k} scope="col" style={th}>
                  {t(`drawer.runs.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          {rows.map(({ arm, r }) => {
            const key = resultKey(r);
            const duration = formatDuration(r.duration_ms);
            const scored = r.status === "done";
            return (
              <tbody key={`${arm}-${r.repeat_idx}`}>
                <tr>
                  <td style={td} className="mono">
                    {t(`drawer.runs.${arm}`)}
                  </td>
                  <td style={td}>{t("drawer.runs.repeatN", { n: r.repeat_idx + 1 })}</td>
                  <td style={{ ...td, fontWeight: 600, color: RESULT_COLOR[key === "queued" || key === "running" ? "muted" : key] }}>
                    {t(`drawer.runs.${key}`)}
                  </td>
                  <td style={td}>{scored ? `${r.matched_must_find.length}/${expected}` : "—"}</td>
                  <td style={td}>{scored ? (r.unexpected ?? 0) : "—"}</td>
                  <td style={td}>{duration ? t("drawer.runs.seconds", { value: duration }) : "—"}</td>
                  <td style={td}>
                    <RunCostValue usd={r.cost_usd} source={r.cost_source} missingReason={r.status === "failed" ? "failed" : "pending"} />
                  </td>
                </tr>
                {r.error && (
                  <tr>
                    <td colSpan={7} style={errorCell}>
                      {r.error}
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      )}
    </Section>
  );
}
