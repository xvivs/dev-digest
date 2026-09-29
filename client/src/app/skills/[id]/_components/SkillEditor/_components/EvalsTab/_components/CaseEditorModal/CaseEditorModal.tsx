/* CaseEditorModal — create or edit one eval case: a name, the diff (pasted,
   or picked from a synced PR's files) and the expectations. Editing keeps the
   stored diff unless the author chooses "Replace diff", so saving a renamed
   case never re-snapshots it. The form is checked client-side against the
   same rules as the contract; server errors (e.g. a file no longer in the
   PR) are shown inline (ADR 0011 local surface). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, Tabs } from "@devdigest/ui";
import type { SkillEvalCase } from "@devdigest/shared";
import { EVAL_CASE_NAME_MAX, type CreateEvalCaseInput } from "@devdigest/shared/contracts/skill-impact";
import { useCreateEvalCase, useUpdateEvalCase } from "@/lib/hooks";
import { ExpectationsEditor } from "./_components/ExpectationsEditor";
import { PrSourcePicker } from "./_components/PrSourcePicker";
import { CASE_MODAL_WIDTH, DIFF_ROWS } from "./constants";
import {
  buildCaseBody,
  diffLineCount,
  draftFromCase,
  emptyRow,
  rowsForKind,
  type CaseDraft,
  type CaseDraftError,
  type ExpectationRowDraft,
  type SourceDraft,
} from "./helpers";
import { s } from "./styles";

type SourceTab = "paste" | "pr";

export function CaseEditorModal({
  skillId,
  editing,
  onClose,
}: {
  skillId: string;
  /** The case to edit, or null for a new one. */
  editing: SkillEvalCase | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const tShell = useTranslations("shell");
  const keyRef = React.useRef(0);
  const nextKey = () => ++keyRef.current;
  const [draft, setDraft] = React.useState<CaseDraft>(() => draftFromCase(editing, nextKey));
  const [invalid, setInvalid] = React.useState<CaseDraftError | null>(null);
  const create = useCreateEvalCase({ meta: { errorSurface: "local" } });
  const update = useUpdateEvalCase({ meta: { errorSurface: "local" } });
  const saving = create.isPending || update.isPending;
  const serverError = create.error ?? update.error;
  const nameId = React.useId();
  const diffId = React.useId();

  const patch = (p: Partial<CaseDraft>) => {
    setInvalid(null);
    setDraft((d) => ({ ...d, ...p }));
  };
  const setSource = (source: SourceDraft) => patch({ source });
  const setRow = (key: number, p: Partial<ExpectationRowDraft>) =>
    setDraft((d) => ({ ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...p } : r)) }));

  const sourceTab: SourceTab = draft.source.mode === "pr" ? "pr" : "paste";
  // Each tab remembers what was entered in it, so a mis-click never loses a pasted diff.
  const stash = React.useRef<{ paste: SourceDraft; pr: SourceDraft }>({
    paste: { mode: "paste", diff: "" },
    pr: { mode: "pr", prId: null, files: [] },
  });
  const switchSourceTab = (tab: string) => {
    if (tab === sourceTab) return;
    if (draft.source.mode !== "keep") stash.current[sourceTab] = draft.source;
    setSource(tab === "pr" ? stash.current.pr : stash.current.paste);
  };

  const save = () => {
    const body = buildCaseBody(draft);
    if (!body.ok) {
      setInvalid(body.error);
      return;
    }
    if (editing) {
      update.mutate({ skillId, caseId: editing.id, patch: body.value }, { onSuccess: onClose });
    } else {
      // A new case always carries a source: buildCaseBody only drops it for `keep`, which a new case never has.
      create.mutate({ skillId, body: body.value as CreateEvalCaseInput }, { onSuccess: onClose });
    }
  };

  return (
    <Modal
      width={CASE_MODAL_WIDTH}
      title={editing ? t("skillEvals.caseModal.editTitle", { name: editing.name }) : t("skillEvals.caseModal.newTitle")}
      closeLabel={tShell("ui.close")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("skillEvals.caseModal.cancel")}
          </Button>
          <Button kind="primary" icon="Check" onClick={save} disabled={saving}>
            {saving ? t("skillEvals.caseModal.saving") : t("skillEvals.caseModal.save")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.field}>
          <label htmlFor={nameId} style={s.label}>
            {t("skillEvals.caseModal.name")}
          </label>
          <input
            id={nameId}
            className="mono"
            value={draft.name}
            maxLength={EVAL_CASE_NAME_MAX}
            placeholder={t("skillEvals.caseModal.namePlaceholder")}
            onChange={(e) => patch({ name: e.target.value })}
            style={s.input}
          />
        </div>

        <section style={s.field}>
          <div style={s.label}>{t("skillEvals.caseModal.source")}</div>
          {draft.source.mode === "keep" && editing ? (
            <div style={s.keep}>
              <span style={s.hint}>
                {t("skillEvals.caseModal.currentDiff", {
                  source:
                    editing.input_source?.kind === "pr" && editing.input_source.pr_number != null
                      ? t("skillEvals.cases.fromPr", { number: editing.input_source.pr_number })
                      : t("skillEvals.cases.fromPaste"),
                  lines: diffLineCount(editing.input_diff),
                })}
              </span>
              <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => setSource(stash.current.paste)}>
                {t("skillEvals.caseModal.replaceDiff")}
              </Button>
            </div>
          ) : (
            <>
              <Tabs
                pad="0"
                value={sourceTab}
                onChange={switchSourceTab}
                tabs={[
                  { key: "paste", label: t("skillEvals.caseModal.tabs.paste"), icon: "FileText" },
                  { key: "pr", label: t("skillEvals.caseModal.tabs.pr"), icon: "GitPullRequest" },
                ]}
              />
              <div style={s.tabBody}>
                {draft.source.mode === "paste" && (
                  <>
                    <label htmlFor={diffId} style={s.srOnly}>
                      {t("skillEvals.caseModal.diffLabel")}
                    </label>
                    <textarea
                      id={diffId}
                      className="mono"
                      rows={DIFF_ROWS}
                      value={draft.source.diff}
                      placeholder={t("skillEvals.caseModal.diffPlaceholder")}
                      onChange={(e) => setSource({ mode: "paste", diff: e.target.value })}
                      style={s.textarea}
                    />
                  </>
                )}
                {draft.source.mode === "pr" && (
                  <PrSourcePicker
                    prId={draft.source.prId}
                    files={draft.source.files}
                    onChange={({ prId, files }) => setSource({ mode: "pr", prId, files })}
                  />
                )}
              </div>
              {editing && (
                <div>
                  <Button kind="ghost" size="sm" onClick={() => setSource({ mode: "keep" })}>
                    {t("skillEvals.caseModal.keepDiff")}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        <section style={s.field}>
          <div style={s.sectionTitle}>{t("skillEvals.caseModal.expectations")}</div>
          <ExpectationsEditor
            kind={draft.kind}
            rows={draft.rows}
            onKind={(kind) => patch({ kind, rows: rowsForKind(draft.rows, kind) })}
            onRow={(key, p) => {
              setInvalid(null);
              setRow(key, p);
            }}
            onAdd={() => patch({ rows: [...draft.rows, emptyRow(nextKey(), draft.kind)] })}
            onRemove={(key) => patch({ rows: draft.rows.filter((r) => r.key !== key) })}
          />
        </section>

        {invalid && (
          <p role="alert" style={s.error}>
            {"index" in invalid
              ? t(`skillEvals.caseModal.errors.${invalid.key}`, { index: invalid.index })
              : t(`skillEvals.caseModal.errors.${invalid.key}`)}
          </p>
        )}
        {serverError && !invalid && (
          <p role="alert" style={s.error}>
            {t("skillEvals.caseModal.errors.generic", { message: serverError.message })}
          </p>
        )}
      </div>
    </Modal>
  );
}
