/* ExpectationsSection — the case's must_find rows (marked matched / partial /
   missed from the with-skill repeats) and must_not_find rows. Marks are hidden
   when the case was edited after the suite ran: the server's indexes may no
   longer line up with the rows. */
"use client";

import React from "react";
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { EvalCaseRunDetail, EvalExpectation } from "@devdigest/shared";
import { mustFindMark, type MustFindMark } from "../../helpers";
import { Section } from "../Section";

const list: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 };
const row: CSSProperties = { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", fontSize: 12.5 };
const meta: CSSProperties = { fontSize: 11.5, color: "var(--text-muted)" };
const heading: CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--text-muted)", margin: "0 0 6px" };
const MARK_COLOR = { matched: "var(--ok)", partial: "var(--warn)", missed: "var(--crit)" } as const;

type Line = { start: number; end: number } | undefined;
type Row = { file: string; line_range?: Line; min_severity?: string; category?: string; contains?: string };

export function ExpectationsSection({
  expectation,
  withRuns,
  showMarks,
}: {
  expectation: EvalExpectation | null;
  withRuns: readonly EvalCaseRunDetail[];
  showMarks: boolean;
}) {
  const t = useTranslations("eval");
  const mark = (m: MustFindMark) =>
    m.kind === "none" ? null : (
      <strong style={{ fontSize: 11.5, color: MARK_COLOR[m.kind] }}>
        {m.kind === "partial" ? t("drawer.expectations.partial", { hit: m.hit, done: m.done }) : t(`drawer.expectations.${m.kind}`)}
      </strong>
    );
  const details = (r: Row) =>
    [
      r.line_range ? t("drawer.expectations.lines", { start: r.line_range.start, end: r.line_range.end }) : null,
      r.min_severity ?? null,
      r.category ?? null,
      r.contains ? t("drawer.expectations.contains", { text: r.contains }) : null,
    ]
      .filter((x): x is string => x !== null)
      .map((text) => (
        <span key={text} style={meta}>
          {text}
        </span>
      ));
  return (
    <Section title={t("drawer.expectations.title")}>
      {!expectation ? (
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("drawer.expectations.none")}</span>
      ) : (
        <>
          {expectation.must_find.length > 0 && (
            <>
              <h4 style={heading}>{t("drawer.expectations.mustFind")}</h4>
              <ul style={list}>
                {expectation.must_find.map((r, i) => (
                  <li key={i} style={row}>
                    <span className="mono">{r.file}</span>
                    {details(r)}
                    {showMarks && mark(mustFindMark(i, withRuns))}
                  </li>
                ))}
              </ul>
            </>
          )}
          {expectation.must_not_find.length > 0 && (
            <>
              <h4 style={heading}>{t("drawer.expectations.mustNotFind")}</h4>
              <ul style={list}>
                {expectation.must_not_find.map((r, i) => (
                  <li key={i} style={row}>
                    <span className="mono">{r.file}</span>
                    {details(r)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Section>
  );
}
