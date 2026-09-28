/* RestoreVersionModal — the Edit / Restore / Cancel popup (ADR 0016 decision 4).
 * - Edit hands vN to the Config tab as an unsaved draft; nothing is written.
 * - Restore calls the guarded endpoint and appends vN+1 at once.
 * - Cancel closes.
 * Focus trap, Escape and focus return come from `Modal` (ADR 0009). The
 * mutation owns its error surface (ADR 0011): a 409 reads "skill changed —
 * reload" with a Reload action, never a generic toast. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useRestoreSkillVersion } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { RESTORE_MODAL_WIDTH } from "./constants";
import { isVersionStale, restoreResetsVetting } from "./helpers";
import { s } from "./styles";

export function RestoreVersionModal({
  skill,
  version,
  onEdit,
  onClose,
  onReload,
}: {
  skill: Skill;
  version: number;
  /** Open vN in Config as a draft. */
  onEdit: (version: number) => void;
  onClose: () => void;
  /** Refetch the skill and its versions after a 409. */
  onReload: () => void;
}) {
  const t = useTranslations("skills");
  const tShell = useTranslations("shell");
  const toast = useToast();
  const restore = useRestoreSkillVersion({ meta: { errorSurface: "local" } });
  const next = skill.version + 1;
  const ids = { edit: React.useId(), restore: React.useId(), cancel: React.useId() };

  const onRestore = () =>
    restore.mutate(
      { id: skill.id, version, expectedVersion: skill.version },
      {
        onSuccess: ({ skill: saved, restored }) => {
          toast.success(
            restored
              ? t("versions.restoreModal.restoredToast", { version, next: saved.version })
              : t("versions.restoreModal.noopToast", { version }),
          );
          onClose();
        },
      },
    );

  const reload = () => {
    restore.reset();
    onReload();
  };

  const stale = restore.isError && isVersionStale(restore.error);

  return (
    <Modal
      width={RESTORE_MODAL_WIDTH}
      title={t("versions.restoreModal.title", { version })}
      subtitle={t("versions.restoreModal.subtitle", { version })}
      closeLabel={tShell("ui.close")}
      onClose={onClose}
    >
      <div style={s.body}>
        {restoreResetsVetting(skill.source) && <div style={s.warning}>{t("versions.restoreModal.importedWarning")}</div>}
        <ul style={s.options}>
          <li style={s.option}>
            <Button kind="secondary" icon="Edit" style={s.optionButton} aria-describedby={ids.edit} onClick={() => onEdit(version)}>
              {t("versions.restoreModal.edit")}
            </Button>
            <span id={ids.edit} style={s.hint}>
              {t("versions.restoreModal.editHint", { version })}
            </span>
          </li>
          <li style={s.option}>
            <Button
              kind="primary"
              icon="History"
              style={s.optionButton}
              aria-describedby={ids.restore}
              onClick={onRestore}
              disabled={restore.isPending || stale}
            >
              {restore.isPending ? t("versions.restoreModal.restoring") : t("versions.restoreModal.restore")}
            </Button>
            <span id={ids.restore} style={s.hint}>
              {t("versions.restoreModal.restoreHint", { version, next })}
            </span>
          </li>
          <li style={s.option}>
            <Button kind="ghost" style={s.optionButton} aria-describedby={ids.cancel} onClick={onClose}>
              {t("versions.restoreModal.cancel")}
            </Button>
            <span id={ids.cancel} style={s.hint}>
              {t("versions.restoreModal.cancelHint")}
            </span>
          </li>
        </ul>
        {restore.isError && (
          <div role="alert" style={s.error}>
            <span style={s.errorText}>
              {stale
                ? t("versions.restoreModal.stale")
                : t("versions.restoreModal.failed", { message: restore.error.message })}
            </span>
            {stale && (
              <Button kind="secondary" size="sm" icon="RefreshCw" onClick={reload}>
                {t("versions.restoreModal.reload")}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
