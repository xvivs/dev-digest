/* RestoreVersionModal: a confirmation dialog with one action, Restore (ADR 0016
 * decision 4). The Edit path (open vN in Config as a draft) was removed from
 * this modal; only Restore and Cancel remain.
 * - Restore calls the guarded endpoint and appends vN+1 at once.
 * - Cancel closes.
 * Focus trap, Escape and focus return come from `Modal` (ADR 0009). Restore
 * takes initial focus via `autoFocus` plus a mount effect. The mutation owns
 * its error surface (ADR 0011): a 409 reads "skill changed, reload" with a Reload action, never
 * a generic toast. */
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
  onClose,
  onReload,
}: {
  skill: Skill;
  version: number;
  onClose: () => void;
  /** Refetch the skill and its versions after a 409. */
  onReload: () => void;
}) {
  const t = useTranslations("skills");
  const tShell = useTranslations("shell");
  const toast = useToast();
  const restore = useRestoreSkillVersion({ meta: { errorSurface: "local" } });
  const next = skill.version + 1;
  const footerRef = React.useRef<HTMLDivElement>(null);
  // `autoFocus` alone loses to StrictMode's dev-only effect replay: `Modal`'s
  // cleanup hands focus back to the opener, and the replay then lands on the
  // first focusable (the close button). This runs after Modal's effect, so
  // Restore keeps focus in dev too.
  React.useEffect(() => {
    footerRef.current?.querySelector<HTMLButtonElement>("button[data-restore]")?.focus();
  }, []);

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
      closeLabel={tShell("ui.close")}
      onClose={onClose}
      footer={
        <div ref={footerRef} style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("versions.restoreModal.cancel")}
          </Button>
          <Button kind="primary" icon="History" autoFocus data-restore="" onClick={onRestore} disabled={restore.isPending || stale}>
            {restore.isPending ? t("versions.restoreModal.restoring") : t("versions.restoreModal.restore", { next })}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <p style={s.text}>{t("versions.restoreModal.body", { version, next })}</p>
        {restoreResetsVetting(skill.source) && <div style={s.warning}>{t("versions.restoreModal.importedWarning")}</div>}
        {restore.isError && (
          <div role="alert" style={s.error}>
            <span style={s.errorText}>
              {stale
                ? t("versions.restoreModal.stale")
                : t("versions.restoreModal.failed", { message: restore.error.message })}
            </span>
            {stale && (
              // Restore just disabled itself, which would drop focus to <body>;
              // hand it to the one action that can move on.
              <Button kind="secondary" size="sm" icon="RefreshCw" onClick={reload} autoFocus>
                {t("versions.restoreModal.reload")}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
