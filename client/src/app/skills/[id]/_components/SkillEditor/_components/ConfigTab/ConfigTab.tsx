/* ConfigTab — Name/Description/Type/Body + Enabled (SPEC-02 AC-6..AC-9). The
 * fields are a draft seeded from `skill` once. Render it with `key={skill.id}`
 * (see SkillEditor) so switching skills remounts it with a fresh draft.
 *
 * Dirty is computed by comparing the draft to the current `skill` prop on
 * every render — no separate "initial values" copy needed, because the query
 * client never refetches this skill behind the user's back (refetchOnWindowFocus
 * is off; the only thing that changes `skill` is this component's own save).
 * That dirty flag drives three things: the unsaved badge (AC-7), `beforeunload`
 * and the cross-route navigation guard (AC-8, ../../../navigation-guard).
 */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Badge, FormField, Modal, SelectInput, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { SKILLS_HREF, SKILL_TYPE_OPTIONS } from "@/app/skills/constants";
import { useDeleteSkill, useUpdateSkill } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { useNavigationGuard } from "@/app/skills/navigation-guard";
import { VetSkillModal } from "@/app/skills/_components/VetSkillModal";
import { DELETE_MODAL_WIDTH } from "./constants";
import { estimateTokens } from "@/lib/tokens";
import { isSkillDirty } from "./helpers";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const tShell = useTranslations("shell");
  const toast = useToast();
  const router = useRouter();
  const guard = useNavigationGuard();
  const update = useUpdateSkill();
  const del = useDeleteSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);
  const [vetting, setVetting] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const draft = { name, description, type, body, enabled };
  const dirty = isSkillDirty(skill, draft);
  const tokens = estimateTokens(body);
  const typeOptions = SKILL_TYPE_OPTIONS.map((v) => ({
    value: v,
    label: t(`type.${v}`),
  }));

  // Report the dirty flag to the ancestor editor (a mutable ref there, not
  // state — see navigation-guard.ts) so a card click or tab switch elsewhere
  // in the tree can ask before it navigates away.
  React.useEffect(() => {
    guard.setDirty(dirty);
    return () => guard.setDirty(false);
  }, [dirty, guard]);

  // Closing the tab is a real browser event, not a client-side navigation —
  // the guard above cannot see it, so it gets its own listener (AC-8).
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const onEnabledToggle = (next: boolean) => {
    // Turning ON an unvetted skill opens "Review & trust" instead (AC-5, ADR
    // 0012); the modal vets and enables it server-side, then `onVetted` syncs
    // the draft so a later Save doesn't send the stale `enabled: false`.
    if (next && skill.needs_vetting) {
      setVetting(true);
      return;
    }
    setEnabled(next);
  };

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body, enabled } },
      {
        onSuccess: (data) => toast.success(t("config.savedToast", { version: data.version })),
      },
    );

  const onDelete = () => {
    setConfirmingDelete(false);
    del.mutate(skill.id, { onSuccess: () => router.push(SKILLS_HREF) });
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <label style={s.enabledLabel}>
          {t("config.enabled")}
          <Toggle on={enabled} onChange={onEnabledToggle} size={16} />
        </label>
      </div>
      <FormField label={t("config.name")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>
      <FormField label={t("config.description")} hint={t("config.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("config.type")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
      </FormField>
      <FormField
        label={t("config.body")}
        required
        right={
          <div style={s.bodyMeta}>
            {dirty && (
              <Badge color="var(--warn)" bg="var(--warn-bg)">
                {t("config.unsaved")}
              </Badge>
            )}
            <span style={s.tokenCount}>{t("config.tokenCount", { count: tokens })}</span>
          </div>
        }
      >
        <div style={s.bodyFrame}>
          <div className="mono" style={s.bodyFileHeader}>
            {name || skill.name}.md
          </div>
          <Textarea value={body} onChange={setBody} rows={16} mono />
        </div>
      </FormField>
      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending || !dirty}>
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        {update.isSuccess && !dirty && (
          <span style={s.savedNote}>{t("config.saved", { version: update.data?.version })}</span>
        )}
        <Button
          kind="danger"
          icon="Trash"
          style={s.deleteBtn}
          onClick={() => setConfirmingDelete(true)}
          disabled={del.isPending}
        >
          {t("config.delete")}
        </Button>
      </div>

      {vetting && <VetSkillModal skill={skill} onClose={() => setVetting(false)} onVetted={() => setEnabled(true)} />}

      {confirmingDelete && (
        <Modal
          width={DELETE_MODAL_WIDTH}
          title={t("config.delete")}
          closeLabel={tShell("ui.close")}
          onClose={() => setConfirmingDelete(false)}
          footer={
            <div style={s.footer}>
              <Button kind="ghost" onClick={() => setConfirmingDelete(false)}>
                {t("vet.cancel")}
              </Button>
              <Button kind="danger" onClick={onDelete} disabled={del.isPending}>
                {t("config.delete")}
              </Button>
            </div>
          }
        >
          <div style={s.confirmBody}>{t("config.deleteConfirm", { name: skill.name })}</div>
        </Modal>
      )}
    </div>
  );
}
