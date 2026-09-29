/* EvalsTab — the skill's ablation evals (plan Phase 3, ADR 0017/0018).
   Header: "Eval cases", a "P / T passing" badge, Run all / New case.
   One thin line: the latest suite (verdict, mode, carrier, tallies, cost) or
   its live progress. Below: lean case cards (status icon, subtitle, tag, one
   outcome chip); a click opens the case drawer with the full details.
   Runs: "Run all" (and the editor header's "Run on evals", via
   `runRequested`) opens the Run modal for every runnable case; a card's Run
   opens it for that one case (`case_ids`). The running suite is polled until
   it is terminal. `?case=` / `?suite=` are owned by the route (props here), so
   the drawer is linkable and Back closes it. A per-case suite never replaces
   the whole-skill suite: it only overrides its own card. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Modal, Skeleton } from "@devdigest/ui";
import type { EvalSuite, Skill, SkillEvalCase } from "@devdigest/shared";
import { useCancelEvalSuite, useDeleteEvalCase, useEvalSuite, useSkillEvalCases, useSkillEvalSuites } from "@/lib/hooks";
import { CaseEditorModal } from "./_components/CaseEditorModal";
import { CaseList } from "./_components/CaseList";
import { EvalCaseDrawer } from "./_components/EvalCaseDrawer";
import { RunEvalModal } from "./_components/RunEvalModal";
import { SuiteSummary } from "./_components/SuiteSummary";
import { DELETE_MODAL_WIDTH, PASSING_BADGE_LOOK, SKELETON_ROWS, SKELETON_ROW_HEIGHT } from "./constants";
import { mergeCaseResults, newerPartialSuite, passingBadge, runBlockedReason, runnableCaseCount, runningSuite, wholeSkillSuite } from "./helpers";
import { s } from "./styles";

/** Which case the editor is open on: a new one, an existing one, or closed. */
type Editing = { kind: "new" } | { kind: "edit"; c: SkillEvalCase } | null;

export function EvalsTab({
  skill,
  runRequested = false,
  onRunRequestHandled,
  onOpenConfig,
  caseId = null,
  caseSuiteId = null,
  onOpenCase,
  onCloseCase,
  onSelectCaseSuite,
}: {
  skill: Skill;
  /** The editor header's "Run on evals" asked for the Run modal. */
  runRequested?: boolean;
  onRunRequestHandled?: () => void;
  /** Trust gate → Config, where the skill is reviewed and trusted. */
  onOpenConfig: () => void;
  /** `?case=`: the case whose drawer is open. */
  caseId?: string | null;
  /** `?suite=`: the suite the drawer shows; null = the case's latest. */
  caseSuiteId?: string | null;
  onOpenCase?: (caseId: string) => void;
  onCloseCase?: () => void;
  onSelectCaseSuite?: (suiteId: string) => void;
}) {
  const t = useTranslations("eval");
  const tShell = useTranslations("shell");
  const cases = useSkillEvalCases(skill.id);
  const suites = useSkillEvalSuites(skill.id);
  const whole = wholeSkillSuite(suites.data);
  const partial = newerPartialSuite(suites.data);
  const running = runningSuite(suites.data);
  const wholeDetail = useEvalSuite(skill.id, whole?.id);
  const partialDetail = useEvalSuite(skill.id, partial?.id);
  const cancel = useCancelEvalSuite();
  const remove = useDeleteEvalCase();
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const [runOpen, setRunOpen] = React.useState(false);
  const [runCase, setRunCase] = React.useState<{ id: string; name: string } | null>(null);
  const [editing, setEditing] = React.useState<Editing>(null);
  const [deleting, setDeleting] = React.useState<SkillEvalCase | null>(null);

  const openRunAll = () => {
    setRunCase(null);
    setRunOpen(true);
  };
  const openRunCase = (c: SkillEvalCase) => {
    setRunCase({ id: c.id, name: c.name });
    setRunOpen(true);
  };

  // The header button lives in SkillEditorView; it raises a flag instead of
  // reaching into this tab, and the tab acknowledges it once handled.
  React.useEffect(() => {
    if (!runRequested) return;
    openRunAll();
    onRunRequestHandled?.();
  }, [runRequested, onRunRequestHandled]);

  // A `?case=` that names no case of this skill (deleted, bad link): close the drawer.
  React.useEffect(() => {
    if (caseId && cases.isSuccess && !cases.data.some((c) => c.id === caseId)) onCloseCase?.();
  }, [caseId, cases.isSuccess, cases.data, onCloseCase]);

  // Closing the drawer returns focus to its card (the kit already restores it to the
  // opener; a deep link has none, so fall back to the card).
  const openedCase = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (caseId) {
      openedCase.current = caseId;
      return;
    }
    const last = openedCase.current;
    openedCase.current = null;
    if (!last) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    wrapRef.current?.querySelector<HTMLElement>(`[data-case-card="${last}"]`)?.focus();
  }, [caseId]);

  // Header badge and cards read the whole-skill suite; a running suite (whole or per-case) drives the summary line.
  const shown = running ?? whole;
  const shownDetail = shown && shown.id === partial?.id ? partialDetail : wholeDetail;
  const suite = shownDetail.data ?? shown;
  const wholeResults = (wholeDetail.data ?? whole)?.results ?? null;
  const results = mergeCaseResults(wholeDetail.data, partialDetail.data);
  const resultsLoading = (!!whole && wholeDetail.isLoading) || (!!partial && partialDetail.isLoading);
  const runnable = runnableCaseCount(cases.data);
  const blocked = runBlockedReason(runnable, running);
  const runBlockedTitle = running ? t("skillEvals.runBlockedRunning") : null;
  const drawerCase = caseId ? (cases.data?.find((c) => c.id === caseId) ?? null) : null;

  // Started from the drawer's case: follow the new suite there.
  const onStarted = (started: EvalSuite) => {
    if (caseId && started.case_ids?.includes(caseId)) onSelectCaseSuite?.(started.id);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const gone = deleting.id;
    remove.mutate(
      { skillId: skill.id, caseId: gone },
      {
        onSettled: () => setDeleting(null),
        onSuccess: () => {
          if (gone === caseId) onCloseCase?.();
        },
      },
    );
  };

  return (
    <div ref={wrapRef} style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.title}>{t("skillEvals.title")}</h2>
        {wholeResults && <PassingBadge results={wholeResults} />}
        <div style={s.actions}>
          <Button kind="secondary" size="sm" icon="Plus" onClick={() => setEditing({ kind: "new" })}>
            {t("skillEvals.newCase")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            onClick={openRunAll}
            disabled={blocked !== null}
            title={blocked ? t(`skillEvals.${blocked}`) : t("skillEvals.runAllHint")}
          >
            {t("skillEvals.runAll")}
          </Button>
        </div>
      </div>

      {cases.isLoading || suites.isLoading ? (
        <div style={s.skeleton}>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <Skeleton key={i} height={SKELETON_ROW_HEIGHT} />
          ))}
        </div>
      ) : cases.isError || suites.isError ? (
        <ErrorState
          title={t("skillEvals.loadError")}
          onRetry={() => {
            cases.refetch();
            suites.refetch();
          }}
        />
      ) : (
        <>
          {suite ? (
            <SuiteSummary
              suite={suite}
              cancelling={cancel.isPending}
              onCancel={() => cancel.mutate({ skillId: skill.id, suiteId: suite.id })}
            />
          ) : (
            (cases.data?.length ?? 0) > 0 && <p style={s.never}>{t("skillEvals.summary.never")}</p>
          )}

          {(cases.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="FlaskConical"
              title={t("skillEvals.cases.label")}
              body={t("skillEvals.cases.empty")}
              cta={t("skillEvals.newCase")}
              onCta={() => setEditing({ kind: "new" })}
            />
          ) : (
            <CaseList
              cases={cases.data ?? []}
              results={results}
              resultsLoading={resultsLoading}
              runBlockedTitle={runBlockedTitle}
              onOpen={(c) => onOpenCase?.(c.id)}
              onRun={openRunCase}
              onEdit={(c) => setEditing({ kind: "edit", c })}
              onDelete={setDeleting}
            />
          )}
        </>
      )}

      {runOpen && (
        <RunEvalModal
          skill={skill}
          caseTarget={runCase}
          onStarted={onStarted}
          onClose={() => setRunOpen(false)}
          onOpenConfig={() => {
            setRunOpen(false);
            onOpenConfig();
          }}
        />
      )}
      {caseId && (
        <EvalCaseDrawer
          caseId={caseId}
          suiteId={caseSuiteId}
          runBlockedTitle={runBlockedTitle}
          onClose={() => onCloseCase?.()}
          onSelectSuite={(id) => onSelectCaseSuite?.(id)}
          onRun={() => drawerCase && openRunCase(drawerCase)}
          onEdit={() => drawerCase && setEditing({ kind: "edit", c: drawerCase })}
          onDelete={() => drawerCase && setDeleting(drawerCase)}
        />
      )}
      {editing && (
        <CaseEditorModal
          key={editing.kind === "edit" ? editing.c.id : "new"}
          skillId={skill.id}
          editing={editing.kind === "edit" ? editing.c : null}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <Modal
          width={DELETE_MODAL_WIDTH}
          title={t("skillEvals.deleteModal.title")}
          closeLabel={tShell("ui.close")}
          onClose={() => setDeleting(null)}
          footer={
            <div style={s.modalFooter}>
              <Button kind="ghost" onClick={() => setDeleting(null)}>
                {t("skillEvals.deleteModal.cancel")}
              </Button>
              <Button kind="danger" icon="Trash" onClick={confirmDelete} disabled={remove.isPending}>
                {t("skillEvals.deleteModal.confirm")}
              </Button>
            </div>
          }
        >
          <p style={s.modalBody}>{t("skillEvals.deleteModal.body", { name: deleting.name })}</p>
        </Modal>
      )}
    </div>
  );
}

/** "P / T passing", or "— passing · N errored" when nothing settled (no ratio to colour). */
function PassingBadge({ results }: { results: { passing: number; total: number; errored: number } }) {
  const t = useTranslations("eval");
  const b = passingBadge(results);
  const look = PASSING_BADGE_LOOK[b.tone];
  return (
    <span title={t("skillEvals.passingBadgeTitle")}>
      <Badge color={look.color} bg={look.bg}>
        {b.label === "none" ? t("skillEvals.passingBadgeNone") : t("skillEvals.passingBadge", { passing: results.passing, total: results.total })}
        {b.label === "none" && b.errored > 0 && (
          <span style={s.badgeErrored}> {t("skillEvals.passingBadgeErrored", { count: b.errored })}</span>
        )}
      </Badge>
    </span>
  );
}
