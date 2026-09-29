/* TransformToSkillModal — "Create skill from conventions" (AC-42..AC-48).
   Merges the accepted, selected conventions into one skill body the person can
   edit before it is saved. Creating IS the vetting act (D10, ADR 0016): the
   server stores the skill vetted and enabled from the toggle, so the full raw
   body is shown here and nothing else stands between save and a prompt.

   Errors that belong to a field stay on it (V11): a taken name shows beside the
   Name input, a budget overrun in the error box, and neither toasts (the
   mutation opts into `errorSurface: "local"`, ADR 0011). Closing with edits
   asks first (V12); after success the panel stays until dismissed (V14). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { ConventionCandidate, CreateSkillFromConventionsResponse } from "@devdigest/shared";
import { useAgents, useAgentsSkillLinks, useCreateSkillFromConventions, useSkills } from "@/lib/hooks";
import { MAX_ATTACHED_AGENTS } from "../../constants";
import {
  agentBudgets,
  bodyBytes,
  buildConventionSkillBody,
  defaultSkillName,
  isValidSkillName,
} from "../../helpers";
import { DISCARD_MODAL_WIDTH, FIELD_IDS, FIXED_SKILL_TYPE, MODAL_WIDTH } from "./constants";
import { classifyCreateError, isModalDirty, type CreateError } from "./helpers";
import { AgentPicker } from "./_components/AgentPicker";
import { BodyEditor } from "./_components/BodyEditor";
import { BudgetStatus } from "./_components/BudgetStatus";
import { SuccessPanel } from "./_components/SuccessPanel";
import { s } from "./styles";

const LOCAL_ERRORS = { meta: { errorSurface: "local" } } as const;
const EMPTY: readonly never[] = [];

export function TransformToSkillModal({
  repoId,
  repoName,
  conventions,
  onClose,
  onCreated,
}: {
  repoId: string;
  /** Short repo name (`payments-api`), used for the default name, description and preamble. */
  repoName: string;
  /** The accepted, selected conventions, in list order. */
  conventions: readonly ConventionCandidate[];
  onClose: () => void;
  /** Runs once the skill exists, so the page can clear its selection (AC-39). */
  onCreated: () => void;
}) {
  const t = useTranslations("conventions");
  const tShell = useTranslations("shell");

  // The starting values. Lazy state: the body is built once, so later edits are never overwritten.
  const [initial] = React.useState(() => {
    const name = defaultSkillName(repoName);
    return {
      name,
      description: t("modal.descriptionDefault", { count: conventions.length, repo: repoName }),
      enabled: true,
      body: buildConventionSkillBody({ repoName, skillName: name, conventions }),
      agentIds: [] as string[],
    };
  });
  const [name, setName] = React.useState(initial.name);
  const [description, setDescription] = React.useState(initial.description);
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [body, setBody] = React.useState(initial.body);
  const [agentIds, setAgentIds] = React.useState<string[]>(initial.agentIds);
  const [error, setError] = React.useState<CreateError | null>(null);
  const [created, setCreated] = React.useState<CreateSkillFromConventionsResponse | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false);

  const create = useCreateSkillFromConventions(repoId, LOCAL_ERRORS);
  const { data: agents = EMPTY } = useAgents();
  const { data: skills = EMPTY } = useSkills();
  const links = useAgentsSkillLinks(agentIds);

  const agentNames = new Map(agents.map((a) => [a.id, a.name]));
  const size = bodyBytes(body);
  const budgets = agentBudgets(agentIds, links.byAgent, skills, body, enabled);
  const overBudget = budgets.some((b) => b.over);
  const nameInvalid = name !== "" && !isValidSkillName(name);
  const canSubmit = isValidSkillName(name) && body.trim() !== "" && !overBudget && !create.isPending;

  const dirty = isModalDirty(initial, { name, description, enabled, body, agentIds });
  // Nothing to lose once the skill is saved; otherwise edits need a confirmation (AC-46).
  const requestClose = () => (created || !dirty ? onClose() : setConfirmingDiscard(true));

  const submit = async () => {
    setError(null);
    try {
      const res = await create.mutateAsync({
        name,
        description: description.trim() || undefined,
        body,
        enabled,
        convention_ids: conventions.map((c) => c.id),
        agent_ids: agentIds,
      });
      setCreated(res);
      onCreated();
    } catch (err) {
      setError(classifyCreateError(err));
    }
  };

  const errorText = (() => {
    if (!error || error.kind === "name") return null;
    if (error.kind === "budget") {
      const agentName = error.agentId ? agentNames.get(error.agentId) : undefined;
      return agentName ? t("modal.errors.budget", { name: agentName }) : t("modal.errors.budgetUnknown");
    }
    if (error.kind === "notAccepted") return t("modal.errors.notAccepted");
    return error.message || t("modal.errors.generic");
  })();

  const linkedAgents = created
    ? created.linked_agent_ids.map((id) => ({ id, name: agentNames.get(id) ?? id }))
    : [];

  return (
    <>
      <Modal
        width={MODAL_WIDTH}
        title={t("modal.title")}
        subtitle={created ? created.skill.name : name}
        closeLabel={tShell("ui.close")}
        onClose={requestClose}
        footer={
          created ? (
            <div style={s.footer}>
              <span style={s.footerNote} />
              <Button kind="primary" onClick={onClose}>
                {t("modal.success.done")}
              </Button>
            </div>
          ) : (
            <div style={s.footer}>
              <span style={s.footerNote}>{t("modal.footerNote")}</span>
              <Button kind="ghost" onClick={requestClose}>
                {t("modal.cancel")}
              </Button>
              <Button kind="primary" icon="Sparkles" onClick={submit} disabled={!canSubmit}>
                {create.isPending ? t("modal.creating") : t("modal.create")}
              </Button>
            </div>
          )
        }
      >
        {created ? (
          <SuccessPanel skill={created.skill} linkedAgents={linkedAgents} />
        ) : (
          <div style={s.body}>
            <div style={s.banner}>
              <span>
                {t.rich("modal.banner", {
                  count: conventions.length,
                  repo: repoName,
                  b: (chunks) => <strong style={s.bannerStrong}>{chunks}</strong>,
                  repoTag: (chunks) => (
                    <span className="mono" style={s.bannerRepo}>
                      {chunks}
                    </span>
                  ),
                })}
              </span>
            </div>
            {errorText && (
              <div role="alert" style={s.errorBox}>
                {errorText}
              </div>
            )}
            <FormField label={t("modal.name")} required htmlFor={FIELD_IDS.name} hint={t("modal.nameHint")}>
              <TextInput
                id={FIELD_IDS.name}
                value={name}
                onChange={(v) => {
                  setName(v);
                  if (error?.kind === "name") setError(null);
                }}
                mono
                aria-invalid={nameInvalid || error?.kind === "name"}
              />
              {nameInvalid && (
                <div role="alert" style={s.fieldError}>
                  {t("modal.nameInvalid")}
                </div>
              )}
              {error?.kind === "name" && (
                <div role="alert" style={s.fieldError}>
                  {t("modal.nameTaken", { name })}
                </div>
              )}
            </FormField>
            <FormField label={t("modal.description")} htmlFor={FIELD_IDS.description}>
              <TextInput id={FIELD_IDS.description} value={description} onChange={setDescription} />
            </FormField>
            <div style={s.twoCols}>
              <FormField label={t("modal.type")} htmlFor={FIELD_IDS.type}>
                <SelectInput
                  id={FIELD_IDS.type}
                  value={FIXED_SKILL_TYPE}
                  options={[FIXED_SKILL_TYPE]}
                  disabled
                />
              </FormField>
              <FormField label={t("modal.enabled")} hint={t("modal.enabledHint")}>
                <Toggle on={enabled} onChange={setEnabled} label={t("modal.enabled")} />
              </FormField>
            </div>
            <FormField label={t("modal.body")} required>
              <BodyEditor fileName={name || initial.name} body={body} bytes={size} onChange={setBody} />
            </FormField>
            <FormField label={t("modal.attach")} htmlFor={FIELD_IDS.agents} hint={t("modal.attachHint", { max: MAX_ATTACHED_AGENTS })}>
              <AgentPicker id={FIELD_IDS.agents} agents={agents} selectedIds={agentIds} onChange={setAgentIds} />
            </FormField>
            <BudgetStatus
              bodyBytes={size}
              agentIds={agentIds}
              budgets={budgets}
              agentNames={agentNames}
              pending={links.isPending}
            />
          </div>
        )}
      </Modal>
      {confirmingDiscard && (
        <Modal
          width={DISCARD_MODAL_WIDTH}
          title={t("modal.dirty.title")}
          closeLabel={tShell("ui.close")}
          onClose={() => setConfirmingDiscard(false)}
          footer={
            <div style={s.confirmFooter}>
              <Button kind="ghost" onClick={() => setConfirmingDiscard(false)}>
                {t("modal.dirty.cancel")}
              </Button>
              <Button kind="danger" onClick={onClose}>
                {t("modal.dirty.confirm")}
              </Button>
            </div>
          }
        >
          <div style={s.confirmBody}>{t("modal.dirty.body")}</div>
        </Modal>
      )}
    </>
  );
}
