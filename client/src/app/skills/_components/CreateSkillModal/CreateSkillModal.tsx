"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { SKILL_TYPE_OPTIONS } from "@/app/skills/constants";
import { skillEditorHref } from "@/app/skills/helpers";
import { useCreateSkill } from "@/lib/hooks";
import { DEFAULT_SKILL_TYPE, MODAL_WIDTH } from "./constants";
import { s } from "./styles";

/** Create-skill modal — name/description/type/body, source "manual" (trusted on save, ADR 0012). */
export function CreateSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const tShell = useTranslations("shell");
  const router = useRouter();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_SKILL_TYPE);
  const [body, setBody] = React.useState(t("create.defaultBody"));

  const typeOptions = SKILL_TYPE_OPTIONS.map((v) => ({ value: v, label: t(`type.${v}`) }));

  const submit = async () => {
    const skill = await create.mutateAsync({ name: name.trim(), description, type, body, source: "manual" });
    onClose();
    router.push(skillEditorHref(skill.id));
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("create.title")}
      closeLabel={tShell("ui.close")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending || !name.trim()}>
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("create.fields.name")} required>
          <TextInput value={name} onChange={setName} placeholder={t("create.fields.namePlaceholder")} mono />
        </FormField>
        <FormField label={t("create.fields.description")} hint={t("config.descriptionHint")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("create.fields.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("create.fields.type")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
        </FormField>
        <FormField label={t("create.fields.body")}>
          <Textarea value={body} onChange={setBody} rows={6} mono />
        </FormField>
      </div>
    </Modal>
  );
}
