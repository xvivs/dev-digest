/* ImportSkillDrawer — import a skill from a `.md` file or a `.zip` archive
   (SPEC-02 AC-20..AC-24, ADR 0012). Two steps:
     1. pick    — a native file input (accept=".md,.zip"); a parse error
                  (no SKILL.md, too big, bomb, bad UTF-8, NUL) shows here and
                  stores nothing.
     2. preview — editable Name/Description/Type, a read-only Rendered/Source
                  body preview (shared `SkillBodyPreview`, ADR 0010), the
                  archive's skipped/rejected entries, and the trust banner.
   Cancel (at either step) calls `onClose` and stores nothing. Import posts
   `source: "imported"` — the server forces `enabled=false,
   needs_vetting=true` regardless of what this request says (AC-23). Nothing
   here executes, evaluates or links to archive content: every file name
   renders as JSX text only, and no object URL is ever created (see
   ./helpers.ts for the parser itself). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Drawer, FormField, SelectInput, TextInput } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useCreateSkill } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { SKILL_TYPE_OPTIONS } from "@/app/skills/constants";
import { skillEditorHref } from "@/app/skills/helpers";
import { SkillBodyPreview } from "@/app/skills/_components/SkillBodyPreview";
import { DEFAULT_IMPORT_SKILL_TYPE, DRAWER_WIDTH, IMPORT_ACCEPT } from "./constants";
import {
  ImportParseError,
  parseImportFile,
  type ImportParseErrorCode,
  type ParsedSkillDraft,
  type ZipEntryInfo,
} from "./helpers";
import { s } from "./styles";

type Phase = "pick" | "preview";
type SubmitErrorField = "name" | "body" | "general";
interface SubmitError {
  field: SubmitErrorField;
  message: string;
}

export function ImportSkillDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const tShell = useTranslations("shell");
  const router = useRouter();
  const toast = useToast();
  // 409/422 render inline next to the field, so skip the global toast (ADR 0011).
  const create = useCreateSkill({ meta: { errorSurface: "local" } });
  const nameErrorId = React.useId();

  const [phase, setPhase] = React.useState<Phase>("pick");
  const [reading, setReading] = React.useState(false);
  const [parseError, setParseError] = React.useState<ImportParseErrorCode | null>(null);
  const [entries, setEntries] = React.useState<ZipEntryInfo[]>([]);
  const [submitError, setSubmitError] = React.useState<SubmitError | null>(null);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_IMPORT_SKILL_TYPE);
  const [body, setBody] = React.useState("");

  const typeOptions = SKILL_TYPE_OPTIONS.map((v) => ({ value: v, label: t(`type.${v}`) }));

  const applyDraft = (draft: ParsedSkillDraft) => {
    setName(draft.name);
    setDescription(draft.description);
    setType(draft.type);
    setBody(draft.body);
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input value so picking the exact same file again after
    // "Choose a different file" still fires a change event.
    e.target.value = "";
    if (!file) return;

    setParseError(null);
    setSubmitError(null);
    setReading(true);
    try {
      const result = await parseImportFile(file);
      applyDraft(result.skill);
      setEntries(result.entries);
      setPhase("preview");
    } catch (err) {
      setParseError(err instanceof ImportParseError ? err.code : "readFailed");
    } finally {
      setReading(false);
    }
  };

  const backToPick = () => {
    setPhase("pick");
    setEntries([]);
    setParseError(null);
    setSubmitError(null);
  };

  const submit = async () => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        description,
        type,
        body,
        source: "imported",
      });
      toast.success(t("file.success", { name: created.name }));
      onClose();
      router.push(skillEditorHref(created.id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSubmitError({ field: "name", message: err.message });
      } else if (err instanceof ApiError && err.status === 422) {
        setSubmitError({ field: "body", message: err.message });
      } else {
        setSubmitError({
          field: "general",
          message: err instanceof ApiError ? err.message : t("drawer.importFailed"),
        });
      }
    }
  };

  const skipped = entries.filter((entry) => !entry.rejected);
  const rejected = entries.filter((entry) => entry.rejected);
  const canImport = !create.isPending && !!name.trim() && !!description.trim() && !!body.trim();

  return (
    <Drawer
      width={DRAWER_WIDTH}
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      closeLabel={tShell("ui.close")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("drawer.cancel")}
          </Button>
          {phase === "preview" && (
            <Button kind="primary" icon="Upload" onClick={submit} disabled={!canImport}>
              {create.isPending ? t("file.importing") : t("file.import")}
            </Button>
          )}
        </div>
      }
    >
      {phase === "pick" ? (
        <div>
          <FormField label={t("drawer.chooseFile")} hint={t("drawer.chooseFileHint")}>
            <input
              aria-label={t("drawer.chooseFile")}
              type="file"
              accept={IMPORT_ACCEPT}
              onChange={onFileChange}
              disabled={reading}
              style={s.fileInput}
            />
          </FormField>
          {reading && <div style={s.status}>{t("drawer.reading")}</div>}
          {parseError && <div role="alert" style={s.error}>{t(`drawer.errors.${parseError}`)}</div>}
        </div>
      ) : (
        <div>
          <div style={s.trustBanner}>{t("drawer.trustBanner")}</div>

          <FormField label={t("file.nameLabel")} hint={t("file.nameHint")} required>
            <TextInput
              value={name}
              onChange={setName}
              placeholder={t("file.namePlaceholder")}
              mono
              aria-describedby={submitError?.field === "name" ? nameErrorId : undefined}
              aria-invalid={submitError?.field === "name"}
            />
          </FormField>
          {submitError?.field === "name" && (
            <div id={nameErrorId} role="alert" style={s.fieldError}>
              {submitError.message}
            </div>
          )}

          <FormField label={t("file.descriptionLabel")} hint={t("config.descriptionHint")} required>
            <TextInput
              value={description}
              onChange={setDescription}
              placeholder={t("file.descriptionPlaceholder")}
            />
          </FormField>

          <FormField label={t("file.typeLabel")}>
            <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
          </FormField>

          <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
            <SkillBodyPreview body={body} />
          </FormField>
          {submitError?.field === "body" && (
            <div role="alert" style={s.fieldError}>
              {submitError.message}
            </div>
          )}

          {entries.length > 0 && (
            <FormField label={t("drawer.entries.title")}>
              <ul style={s.entryList}>
                {skipped.map((entry) => (
                  <li key={entry.name} style={s.entryRow}>
                    <span className="mono" style={s.entryName}>
                      {entry.name}
                    </span>
                    <span style={s.entryTag}>
                      {entry.executable ? t("drawer.entries.executable") : t("drawer.entries.skipped")}
                    </span>
                  </li>
                ))}
                {rejected.map((entry) => (
                  <li key={entry.name} style={s.entryRow}>
                    <span className="mono" style={s.entryName}>
                      {entry.name}
                    </span>
                    <span style={s.entryTagRejected}>{t("drawer.entries.rejected")}</span>
                  </li>
                ))}
              </ul>
            </FormField>
          )}

          {submitError?.field === "general" && (
            <div role="alert" style={s.error}>
              {submitError.message}
            </div>
          )}

          <div style={s.changeFileRow}>
            <Button kind="ghost" size="sm" onClick={backToPick} disabled={create.isPending}>
              {t("drawer.changeFile")}
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
