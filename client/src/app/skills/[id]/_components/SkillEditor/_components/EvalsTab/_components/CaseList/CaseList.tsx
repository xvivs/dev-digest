/* CaseList — the skill's eval cases as lean cards (option B, design-evals-spec):
   status icon (the with-skill result) · mono name · subtitle ("expected N
   findings, matched X" / "never run") · grey "SEVERITY · category" tag · one
   chip for caught / regressed / flaky · run / edit / delete icons.
   Everything else (arm tallies, runs, findings, input, history) lives in the
   case drawer, opened by clicking or pressing Enter/Space on the card.
   Presentational: EvalsTab owns the drawer, the editor, the delete confirm
   and the per-case Run modal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@devdigest/ui";
import type { EvalSuiteCaseResult, SkillEvalCase } from "@devdigest/shared";
import { CASE_ICON_LOOK, CASE_ICON_SIZE, OUTCOME_LOOK } from "../../constants";
import { caseIconState } from "../../helpers";
import { caseSubtitle, caseTag, formatCount, showsOutcomeChip } from "./helpers";
import { s } from "./styles";

export function CaseList({
  cases,
  results,
  resultsLoading = false,
  runBlockedTitle = null,
  onOpen,
  onRun,
  onEdit,
  onDelete,
}: {
  cases: readonly SkillEvalCase[];
  /** Per-case result of the newest suite that ran the case; absent = never run. */
  results: ReadonlyMap<string, EvalSuiteCaseResult>;
  /** A suite exists but its detail has not arrived yet: no "never run" flash. */
  resultsLoading?: boolean;
  /** Why the per-case Run is unavailable (a suite is running), or null. */
  runBlockedTitle?: string | null;
  onOpen: (c: SkillEvalCase) => void;
  onRun: (c: SkillEvalCase) => void;
  onEdit: (c: SkillEvalCase) => void;
  onDelete: (c: SkillEvalCase) => void;
}) {
  const t = useTranslations("eval");
  return (
    <ul aria-label={t("skillEvals.cases.label")} style={s.list}>
      {cases.map((c) => (
        <CaseCard
          key={c.id}
          c={c}
          result={results.get(c.id) ?? null}
          loading={resultsLoading}
          runBlockedTitle={runBlockedTitle}
          onOpen={() => onOpen(c)}
          onRun={() => onRun(c)}
          onEdit={() => onEdit(c)}
          onDelete={() => onDelete(c)}
        />
      ))}
    </ul>
  );
}

function CaseCard({
  c,
  result,
  loading,
  runBlockedTitle,
  onOpen,
  onRun,
  onEdit,
  onDelete,
}: {
  c: SkillEvalCase;
  result: EvalSuiteCaseResult | null;
  loading: boolean;
  runBlockedTitle: string | null;
  onOpen: () => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const [active, setActive] = React.useState(false);
  const legacy = c.expectation === null;
  const state = caseIconState(result);
  const look = CASE_ICON_LOOK[state];
  const StatusIcon = Icon[look.icon];
  const tag = caseTag(c.expectation);
  const subtitleText = legacy ? t("skillEvals.cases.legacy") : loading && !result ? "" : subtitleFor(t, caseSubtitle(result));
  const statusText = t(`skillEvals.cases.status.${state}`);
  const chip = result && showsOutcomeChip(result.outcome) ? result.outcome : null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };

  return (
    <li
      style={s.card(active)}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
    >
      <div
        role="button"
        tabIndex={0}
        data-case-card={c.id}
        aria-label={t("skillEvals.cases.cardLabel", { name: c.name, status: statusText, detail: subtitleText })}
        onClick={onOpen}
        onKeyDown={onKeyDown}
        style={s.open}
      >
        <span aria-hidden="true" title={statusText} style={s.icon(look.color)}>
          <StatusIcon size={CASE_ICON_SIZE} />
        </span>
        <div style={s.main}>
          <span className="mono" style={s.name}>
            {c.name}
          </span>
          <span style={{ ...s.subtitle, ...(legacy ? s.legacy : null) }} title={legacy ? t("skillEvals.cases.legacyTitle") : undefined}>
            {subtitleText}
          </span>
        </div>
        {tag && (
          <span className={tag.kind === "clean" ? "mono" : undefined} style={s.tag}>
            {tag.kind === "clean"
              ? t("skillEvals.cases.tagClean")
              : `${tag.severity} · ${tag.category}${tag.more > 0 ? ` ${t("skillEvals.cases.tagMore", { count: tag.more })}` : ""}`}
          </span>
        )}
        {chip && (
          <span
            title={t(`skillEvals.cases.outcomeTitle.${chip}`)}
            style={{ ...s.chip, color: OUTCOME_LOOK[chip].color, background: OUTCOME_LOOK[chip].bg }}
          >
            {t(`skillEvals.cases.outcome.${chip}`)}
          </span>
        )}
      </div>

      <div style={s.actions(active)} onClick={(e) => e.stopPropagation()}>
        <ActionBtn
          icon="Play"
          label={t("skillEvals.cases.runLabel", { name: c.name })}
          onClick={onRun}
          disabled={legacy || runBlockedTitle !== null}
          title={legacy ? t("skillEvals.cases.legacyTitle") : (runBlockedTitle ?? undefined)}
        />
        <ActionBtn icon="Edit" label={t("skillEvals.cases.editLabel", { name: c.name })} onClick={onEdit} />
        <ActionBtn icon="Trash" danger label={t("skillEvals.cases.deleteLabel", { name: c.name })} onClick={onDelete} />
      </div>
    </li>
  );
}

function subtitleFor(t: ReturnType<typeof useTranslations>, sub: ReturnType<typeof caseSubtitle>): string {
  const errored = (n: number) => (n > 0 ? ` ${t("skillEvals.cases.subtitle.erroredSuffix", { count: n })}` : "");
  switch (sub.kind) {
    case "never":
      return t("skillEvals.cases.subtitle.never");
    case "pending":
      return t("skillEvals.cases.subtitle.pending");
    case "error":
      return t("skillEvals.cases.subtitle.error");
    case "defect":
      return t("skillEvals.cases.subtitle.defect", { expected: sub.expected, matched: formatCount(sub.matched) }) + errored(sub.errored);
    case "clean":
      return t("skillEvals.cases.subtitle.clean", { got: formatCount(sub.got) }) + errored(sub.errored);
  }
}

/** A 26px icon button (IconBtn from the kit has no disabled state, which Run needs). */
function ActionBtn({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  title,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const I = Icon[icon];
  const [hover, setHover] = React.useState(false);
  const [focus, setFocus] = React.useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={s.actionBtn(danger, disabled, hover || focus)}
    >
      <I size={14} />
    </button>
  );
}
