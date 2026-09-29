/* EvalsTab — the skill's ablation evals (plan Phase 3, ADR 0017/0018).
   Top: the latest started suite (verdict, results line or live progress).
   Below: the eval cases, each showing both arms of that suite and a badge.
   "Run all" (and the editor header's "Run on evals", via `runRequested`)
   opens the Run modal; the running suite is polled until it is terminal.
   Per-case runs are not offered: `CreateEvalSuiteBody` has no case subset,
   so every suite runs all cases with parsed expectations. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Modal, Skeleton } from "@devdigest/ui";
import type { Skill, SkillEvalCase } from "@devdigest/shared";
import { useCancelEvalSuite, useDeleteEvalCase, useEvalSuite, useSkillEvalCases, useSkillEvalSuites } from "@/lib/hooks";
import { CaseEditorModal } from "./_components/CaseEditorModal";
import { CaseList } from "./_components/CaseList";
import { RunEvalModal } from "./_components/RunEvalModal";
import { SuiteSummary } from "./_components/SuiteSummary";
import { DELETE_MODAL_WIDTH, SKELETON_ROWS, SKELETON_ROW_HEIGHT } from "./constants";
import { latestStartedSuite, runBlockedReason, runnableCaseCount } from "./helpers";
import { s } from "./styles";

/** Which case the editor is open on: a new one, an existing one, or closed. */
type Editing = { kind: "new" } | { kind: "edit"; c: SkillEvalCase } | null;

export function EvalsTab({
  skill,
  runRequested = false,
  onRunRequestHandled,
  onOpenConfig,
}: {
  skill: Skill;
  /** The editor header's "Run on evals" asked for the Run modal. */
  runRequested?: boolean;
  onRunRequestHandled?: () => void;
  /** Trust gate → Config, where the skill is reviewed and trusted. */
  onOpenConfig: () => void;
}) {
  const t = useTranslations("eval");
  const tShell = useTranslations("shell");
  const cases = useSkillEvalCases(skill.id);
  const suites = useSkillEvalSuites(skill.id);
  const latest = latestStartedSuite(suites.data);
  const detail = useEvalSuite(skill.id, latest?.id);
  const cancel = useCancelEvalSuite();
  const remove = useDeleteEvalCase();

  const [runOpen, setRunOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Editing>(null);
  const [deleting, setDeleting] = React.useState<SkillEvalCase | null>(null);

  // The header button lives in SkillEditorView; it raises a flag instead of
  // reaching into this tab, and the tab acknowledges it once handled.
  React.useEffect(() => {
    if (!runRequested) return;
    setRunOpen(true);
    onRunRequestHandled?.();
  }, [runRequested, onRunRequestHandled]);

  // The polled detail is fresher than the list row; fall back to the row until it loads.
  const suite = detail.data ?? latest;
  const runnable = runnableCaseCount(cases.data);
  const blocked = runBlockedReason(runnable, suite);

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate({ skillId: skill.id, caseId: deleting.id }, { onSettled: () => setDeleting(null) });
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h2 style={s.title}>{t("skillEvals.title")}</h2>
          <p style={s.caption}>{t("skillEvals.caption")}</p>
        </div>
        <div style={s.actions}>
          <Button kind="secondary" size="sm" icon="Plus" onClick={() => setEditing({ kind: "new" })}>
            {t("skillEvals.newCase")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            onClick={() => setRunOpen(true)}
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
              suite={detail.data ?? null}
              onEdit={(c) => setEditing({ kind: "edit", c })}
              onDelete={setDeleting}
            />
          )}
        </>
      )}

      {runOpen && (
        <RunEvalModal
          skill={skill}
          onClose={() => setRunOpen(false)}
          onOpenConfig={() => {
            setRunOpen(false);
            onOpenConfig();
          }}
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
