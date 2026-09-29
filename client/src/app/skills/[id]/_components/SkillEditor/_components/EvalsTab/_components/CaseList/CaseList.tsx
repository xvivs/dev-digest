/* CaseList — the skill's eval cases, each with what it expects and, when the
   latest suite ran it, both arms as passes/repeats ("with 3/3 · without 0/3")
   plus an outcome badge (caught / regressed / flaky / …) and a badge for
   extra unexpected findings the skill caused. Presentational: EvalsTab owns
   the editor and the delete confirm. */
"use client";

import { useTranslations } from "next-intl";
import { Badge, IconBtn } from "@devdigest/ui";
import type { EvalSuiteDetail, SkillEvalCase } from "@devdigest/shared";
import { formatSignedDelta } from "@/app/skills/helpers";
import { OUTCOME_LOOK, UNEXPECTED_BADGE_MIN } from "./constants";
import { caseUnexpectedDelta } from "./helpers";
import { s } from "./styles";

export function CaseList({
  cases,
  suite,
  onEdit,
  onDelete,
}: {
  cases: readonly SkillEvalCase[];
  /** Latest started suite's detail, or null when none ran yet. */
  suite: EvalSuiteDetail | null;
  onEdit: (c: SkillEvalCase) => void;
  onDelete: (c: SkillEvalCase) => void;
}) {
  const t = useTranslations("eval");
  return (
    <ul aria-label={t("skillEvals.cases.label")} style={s.list}>
      {cases.map((c) => (
        <CaseRow key={c.id} c={c} suite={suite} onEdit={() => onEdit(c)} onDelete={() => onDelete(c)} />
      ))}
    </ul>
  );
}

function CaseRow({
  c,
  suite,
  onEdit,
  onDelete,
}: {
  c: SkillEvalCase;
  suite: EvalSuiteDetail | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const result = suite?.cases.find((r) => r.case_id === c.id) ?? null;
  const delta = suite ? caseUnexpectedDelta(suite.runs, c.id) : null;
  const exp = c.expectation;

  return (
    <li style={s.row}>
      <div style={s.main}>
        <span className="mono" style={s.name}>
          {c.name}
        </span>
        <span style={s.meta}>
          <SourceLabel c={c} />
          <span aria-hidden="true">·</span>
          {exp === null ? (
            <span title={t("skillEvals.cases.legacyTitle")} style={s.legacy}>
              {t("skillEvals.cases.legacy")}
            </span>
          ) : exp.must_find.length > 0 ? (
            <span>{t("skillEvals.cases.defect", { count: exp.must_find.length })}</span>
          ) : (
            <span>{t("skillEvals.cases.clean", { count: exp.must_not_find.length })}</span>
          )}
        </span>
      </div>

      <div style={s.result}>
        {result ? (
          <>
            <span className="mono" title={t("skillEvals.cases.withTitle")} style={s.arm}>
              {t("skillEvals.cases.withArm", result.with)}
            </span>
            <span className="mono" title={t("skillEvals.cases.withoutTitle")} style={s.arm}>
              {t("skillEvals.cases.withoutArm", result.without)}
            </span>
            <span title={t(`skillEvals.cases.outcomeTitle.${result.outcome}`)}>
              <Badge color={OUTCOME_LOOK[result.outcome].color} bg={OUTCOME_LOOK[result.outcome].bg} icon={OUTCOME_LOOK[result.outcome].icon}>
                {t(`skillEvals.cases.outcome.${result.outcome}`)}
              </Badge>
            </span>
            {delta != null && delta >= UNEXPECTED_BADGE_MIN && (
              <span title={t("skillEvals.cases.unexpectedTitle")}>
                <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                  {t("skillEvals.cases.unexpected", { value: formatSignedDelta(delta).replace(/^\+/, "") })}
                </Badge>
              </span>
            )}
          </>
        ) : suite ? (
          <span style={s.muted}>{t("skillEvals.cases.notRun")}</span>
        ) : null}
      </div>

      <div style={s.actions}>
        <IconBtn icon="Edit" label={t("skillEvals.cases.editLabel", { name: c.name })} onClick={onEdit} />
        <IconBtn icon="Trash" danger label={t("skillEvals.cases.deleteLabel", { name: c.name })} onClick={onDelete} />
      </div>
    </li>
  );
}

function SourceLabel({ c }: { c: SkillEvalCase }) {
  const t = useTranslations("eval");
  const src = c.input_source;
  if (src?.kind === "pr") {
    return <span>{src.pr_number != null ? t("skillEvals.cases.fromPr", { number: src.pr_number }) : t("skillEvals.cases.fromPrUnknown")}</span>;
  }
  return <span>{t("skillEvals.cases.fromPaste")}</span>;
}
