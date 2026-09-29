/* HistorySection — the case across recent suites (newest first). Clicking a
   row switches the drawer to that suite (`?suite=`). */
"use client";

import React from "react";
import type { CSSProperties } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { EvalCaseHistoryItem } from "@devdigest/shared";
import { Section } from "../Section";

const OUTCOME_COLOR: Record<string, string> = {
  caught: "var(--ok)",
  regressed: "var(--crit)",
  flaky: "var(--warn)",
  error: "var(--crit)",
};
const list: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 };
const item = (current: boolean): CSSProperties => ({
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  padding: "8px 10px",
  borderRadius: 7,
  border: `1px solid ${current ? "var(--border-strong)" : "var(--border)"}`,
  background: current ? "var(--bg-hover)" : "var(--bg-surface)",
  color: "inherit",
  font: "inherit",
  fontSize: 12.5,
  textAlign: "left",
  cursor: "pointer",
});
const tag: CSSProperties = { fontSize: 11.5, color: "var(--text-muted)" };

export function HistorySection({
  history,
  currentSuiteId,
  onSelectSuite,
}: {
  history: readonly EvalCaseHistoryItem[];
  currentSuiteId: string | null;
  onSelectSuite: (suiteId: string) => void;
}) {
  const t = useTranslations("eval");
  const format = useFormatter();
  return (
    <Section title={t("drawer.history.title")}>
      {history.length === 0 ? (
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("drawer.history.empty")}</span>
      ) : (
        <ul style={list}>
          {history.map((h) => {
            const current = h.suite_id === currentSuiteId;
            const when = format.dateTime(new Date(h.created_at), { dateStyle: "medium", timeStyle: "short" });
            return (
              <li key={h.suite_id}>
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  aria-label={t("drawer.history.open", { when })}
                  onClick={() => onSelectSuite(h.suite_id)}
                  style={item(current)}
                >
                  <span>{t("drawer.history.item", { when, mode: t(`skillEvals.summary.mode.${h.mode}`) })}</span>
                  <strong style={{ color: OUTCOME_COLOR[h.outcome] ?? "var(--text-secondary)" }}>{t(`skillEvals.cases.outcome.${h.outcome}`)}</strong>
                  <span className="mono" style={tag}>
                    {t("drawer.history.version", { version: h.skill_version })}
                  </span>
                  {h.partial && <span style={tag}>{t("drawer.partial")}</span>}
                  {h.stale && <span style={{ ...tag, color: "var(--warn)" }}>{t("drawer.stale")}</span>}
                  {current && <span style={{ ...tag, marginLeft: "auto" }}>{t("drawer.history.current")}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
