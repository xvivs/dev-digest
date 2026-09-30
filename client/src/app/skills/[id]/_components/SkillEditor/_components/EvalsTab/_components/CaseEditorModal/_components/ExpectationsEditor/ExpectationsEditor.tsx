/* ExpectationsEditor — the case kind and its rows (EvalExpectation).
   Defect case: must_find rows, each with a required min severity and
   category. Clean case: must_not_find rows, where severity and category may
   be "any" (the contract allows must_not_find only on clean cases). Every
   row: file, optional line range (matched ±3), optional plain-text
   `contains` (never a regex). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, IconBtn } from "@devdigest/ui";
import type { FindingCategory, Severity } from "@devdigest/shared";
import { EVAL_CONTAINS_MAX, EVAL_EXPECTATION_MAX_ITEMS } from "@devdigest/shared/contracts/skill-impact";
import { CATEGORY_OPTIONS, SEVERITY_OPTIONS } from "../../constants";
import type { CaseKind, ExpectationRowDraft } from "../../helpers";
import { s } from "./styles";

const KINDS: readonly CaseKind[] = ["defect", "clean"];

export function ExpectationsEditor({
  kind,
  rows,
  onKind,
  onRow,
  onAdd,
  onRemove,
}: {
  kind: CaseKind;
  rows: readonly ExpectationRowDraft[];
  onKind: (k: CaseKind) => void;
  onRow: (key: number, patch: Partial<ExpectationRowDraft>) => void;
  onAdd: () => void;
  onRemove: (key: number) => void;
}) {
  const t = useTranslations("eval");
  const name = React.useId();
  const optional = kind === "clean";

  return (
    <div style={s.wrap}>
      <fieldset style={s.kinds}>
        <legend style={s.label}>{t("skillEvals.caseModal.kindLabel")}</legend>
        {KINDS.map((k) => (
          <label key={k} style={s.kind}>
            <input type="radio" name={name} value={k} checked={kind === k} onChange={() => onKind(k)} />
            <span>
              <span style={s.kindTitle}>{t(k === "defect" ? "skillEvals.caseModal.kindDefect" : "skillEvals.caseModal.kindClean")}</span>
              <span style={s.hint}>{t(k === "defect" ? "skillEvals.caseModal.kindDefectHint" : "skillEvals.caseModal.kindCleanHint")}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div style={s.label}>{t(kind === "defect" ? "skillEvals.caseModal.mustFind" : "skillEvals.caseModal.mustNotFind")}</div>
      <ol style={s.rows}>
        {rows.map((r, i) => {
          const index = i + 1;
          return (
            <li key={r.key} aria-label={t("skillEvals.caseModal.rowLabel", { index })} style={s.row}>
              <label style={s.cellWide}>
                <span style={s.cellLabel}>{t("skillEvals.caseModal.file")}</span>
                <input
                  className="mono"
                  value={r.file}
                  placeholder={t("skillEvals.caseModal.filePlaceholder")}
                  onChange={(e) => onRow(r.key, { file: e.target.value })}
                  style={s.input}
                />
              </label>
              <label style={s.cellNarrow}>
                <span style={s.cellLabel}>{t("skillEvals.caseModal.lineStart")}</span>
                <input inputMode="numeric" value={r.start} onChange={(e) => onRow(r.key, { start: e.target.value })} style={s.input} />
              </label>
              <label style={s.cellNarrow}>
                <span style={s.cellLabel}>{t("skillEvals.caseModal.lineEnd")}</span>
                <input inputMode="numeric" value={r.end} onChange={(e) => onRow(r.key, { end: e.target.value })} style={s.input} />
              </label>
              <label style={s.cell}>
                <span style={s.cellLabel}>{t("skillEvals.caseModal.severity")}</span>
                <select value={r.severity} onChange={(e) => onRow(r.key, { severity: e.target.value as Severity | "" })} style={s.input}>
                  {optional && <option value="">{t("skillEvals.caseModal.any")}</option>}
                  {SEVERITY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label style={s.cell}>
                <span style={s.cellLabel}>{t("skillEvals.caseModal.category")}</span>
                <select
                  value={r.category}
                  onChange={(e) => onRow(r.key, { category: e.target.value as FindingCategory | "" })}
                  style={s.input}
                >
                  {optional && <option value="">{t("skillEvals.caseModal.any")}</option>}
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label style={s.cellWide}>
                <span style={s.cellLabel}>{t("skillEvals.caseModal.contains")}</span>
                <input
                  value={r.contains}
                  maxLength={EVAL_CONTAINS_MAX}
                  placeholder={t("skillEvals.caseModal.containsPlaceholder")}
                  onChange={(e) => onRow(r.key, { contains: e.target.value })}
                  style={s.input}
                />
              </label>
              <div style={s.remove}>
                <IconBtn icon="X" danger label={t("skillEvals.caseModal.removeRow", { index })} onClick={() => onRemove(r.key)} />
              </div>
            </li>
          );
        })}
      </ol>
      <div>
        <Button kind="ghost" size="sm" icon="Plus" onClick={onAdd} disabled={rows.length >= EVAL_EXPECTATION_MAX_ITEMS}>
          {t("skillEvals.caseModal.addRow")}
        </Button>
      </div>
    </div>
  );
}
