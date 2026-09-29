/* EvalCaseDrawer — right-hand drawer with everything about one eval case
   (like Agent Runs → RunTraceDrawer): summary, per-run table for both arms,
   expectations marked matched/missed, unexpected findings, input, and the
   case's history across suites. The card shows the minimum; this shows the
   rest. Data: GET /eval-cases/:id?suite_id= (useEvalCaseDetail), polled while
   the shown suite runs. The parent owns `?case=` / `?suite=` and the modals. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Drawer, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { EvalCaseDetail } from "@devdigest/shared";
import { useEvalCaseDetail } from "@/lib/hooks";
import { CASE_ICON_LOOK, CASE_ICON_SIZE, OUTCOME_LOOK } from "../../constants";
import { caseIconState } from "../../helpers";
import { DRAWER_WIDTH, SKELETON_BLOCKS, SKELETON_BLOCK_HEIGHT } from "./constants";
import { unexpectedGroups } from "./helpers";
import { s } from "./styles";
import { ExpectationsSection } from "./_components/ExpectationsSection";
import { HistorySection } from "./_components/HistorySection";
import { InputSection } from "./_components/InputSection";
import { RunsSection } from "./_components/RunsSection";
import { Section } from "./_components/Section";

export function EvalCaseDrawer({
  caseId,
  suiteId,
  runBlockedTitle = null,
  onClose,
  onSelectSuite,
  onRun,
  onEdit,
  onDelete,
}: {
  caseId: string;
  /** From `?suite=`; null = the server's latest started suite that ran this case. */
  suiteId: string | null;
  /** Why "Run this case" is unavailable (a suite is running), or null. */
  runBlockedTitle?: string | null;
  onClose: () => void;
  onSelectSuite: (suiteId: string) => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const tShell = useTranslations("shell");
  const query = useEvalCaseDetail(caseId, suiteId);
  const detail = query.data;

  const footer = (
    <div style={s.footer}>
      <Button kind="primary" size="sm" icon="Play" onClick={onRun} disabled={runBlockedTitle !== null} title={runBlockedTitle ?? undefined}>
        {t("drawer.actions.run")}
      </Button>
      <Button kind="secondary" size="sm" icon="Edit" onClick={onEdit} disabled={!detail}>
        {t("drawer.actions.edit")}
      </Button>
      <span style={s.footerSpacer} />
      <Button kind="danger" size="sm" icon="Trash" onClick={onDelete} disabled={!detail}>
        {t("drawer.actions.delete")}
      </Button>
    </div>
  );

  return (
    <Drawer
      width={DRAWER_WIDTH}
      ariaLabel={t("drawer.label")}
      title={detail ? <span className="mono" style={s.title}>{detail.case.name}</span> : undefined}
      subtitle={detail ? <SuiteLine detail={detail} /> : undefined}
      onClose={onClose}
      closeLabel={tShell("ui.close")}
      footer={footer}
    >
      {query.isLoading ? (
        <div role="status" aria-label={t("drawer.loading")} style={s.skeleton}>
          {Array.from({ length: SKELETON_BLOCKS }, (_, i) => (
            <Skeleton key={i} height={SKELETON_BLOCK_HEIGHT} />
          ))}
        </div>
      ) : query.isError || !detail ? (
        <ErrorState title={t("drawer.loadError")} onRetry={() => query.refetch()} />
      ) : (
        <Body detail={detail} onSelectSuite={onSelectSuite} />
      )}
    </Drawer>
  );
}

/** "Full · Carrier · skill v3" + single-case / stale / running markers. */
function SuiteLine({ detail }: { detail: EvalCaseDetail }) {
  const t = useTranslations("eval");
  const suite = detail.suite;
  if (!suite) return null;
  return (
    <span style={s.subtitleRow}>
      <span>
        {t("drawer.suiteLine", {
          mode: t(`skillEvals.summary.mode.${suite.mode}`),
          carrier: suite.carrier_name ?? t("drawer.carrierDeleted"),
          version: suite.skill_version,
        })}
      </span>
      {suite.partial && <span style={s.muted}>{t("drawer.partial")}</span>}
      {suite.stale && <span style={{ ...s.muted, color: "var(--warn)" }}>{t("drawer.stale")}</span>}
      {suite.status === "running" && <span style={s.muted}>{t("drawer.running")}</span>}
    </span>
  );
}

function Body({ detail, onSelectSuite }: { detail: EvalCaseDetail; onSelectSuite: (id: string) => void }) {
  const t = useTranslations("eval");
  const { case: c, suite, arms, outcome } = detail;
  const expected = c.expectation?.must_find.length ?? 0;
  const groups = unexpectedGroups(arms);
  const state = caseIconState(outcome ? { outcome, with: { passed: arms.with.passed, total: arms.with.total } } : null);
  const look = CASE_ICON_LOOK[state];
  const StatusIcon = Icon[look.icon];
  const chip = outcome ? OUTCOME_LOOK[outcome] : null;
  const score = (n: number | null) => (n == null ? t("drawer.summary.noScore") : String(Math.round(n * 10) / 10));

  return (
    <>
      <div style={s.headRow}>
        <span aria-hidden="true" style={s.statusIcon(look.color)} title={t(`skillEvals.cases.status.${state}`)}>
          <StatusIcon size={CASE_ICON_SIZE + 3} />
        </span>
        {outcome && chip && (
          <span title={t(`skillEvals.cases.outcomeTitle.${outcome}`)} style={{ ...s.chip, color: chip.color, background: chip.bg }}>
            {t(`skillEvals.cases.outcome.${outcome}`)}
          </span>
        )}
        {c.notes && <span style={s.muted}>{c.notes}</span>}
      </div>

      {detail.expectation_changed && <div role="note" style={s.warn}>{t("drawer.expectationChanged")}</div>}

      {!suite ? (
        <p style={s.note}>{t("drawer.neverRun")}</p>
      ) : (
        <>
          <Section title={t("drawer.summary.title")}>
            <div style={s.stats} title={t("drawer.summary.medianHint")}>
              <Stat label={t("drawer.summary.expected")} value={String(expected)} />
              <Stat label={t("drawer.summary.matched")} value={score(arms.with.matched_median)} />
              <Stat label={t("drawer.summary.unexpected")} value={score(arms.with.unexpected_median)} />
            </div>
            <div style={s.arms}>
              <span>
                {t("drawer.summary.withSkill")}:{" "}
                <strong style={s.armStrong}>{t("drawer.summary.passed", { passed: arms.with.passed, total: arms.with.total })}</strong>
              </span>
              <span>
                {t("drawer.summary.withoutSkill")}:{" "}
                <strong style={s.armStrong}>{t("drawer.summary.passed", { passed: arms.without.passed, total: arms.without.total })}</strong>
              </span>
            </div>
          </Section>
          <RunsSection arms={arms} expected={expected} />
        </>
      )}

      <ExpectationsSection expectation={c.expectation} withRuns={arms.with.runs} showMarks={!!suite && !detail.expectation_changed} />

      {suite && groups.length > 0 && (
        <Section title={t("drawer.unexpected.title")}>
          {groups.map((g) => (
            <div key={`${g.arm}-${g.repeat_idx}`} style={s.group}>
              <h4 style={s.groupTitle}>{t("drawer.unexpected.arm", { arm: t(`drawer.runs.${g.arm}`), n: g.repeat_idx + 1 })}</h4>
              {g.findings.map((f, i) => (
                <div key={i} style={s.finding}>
                  <span style={s.findingTitle}>{f.title}</span>
                  <span style={s.findingMeta}>
                    <span className="mono">{`${f.file}:${f.line}`}</span>
                    <span>{f.severity}</span>
                    <span>{f.category}</span>
                  </span>
                </div>
              ))}
              {g.hidden > 0 && <span style={s.muted}>{t("drawer.unexpected.more", { count: g.hidden })}</span>}
            </div>
          ))}
        </Section>
      )}

      <InputSection c={c} />
      <HistorySection history={detail.history} currentSuiteId={suite?.id ?? null} onSelectSuite={onSelectSuite} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.stat}>
      <div style={s.statLabel}>{label}</div>
      <div style={s.statVal}>{value}</div>
    </div>
  );
}
