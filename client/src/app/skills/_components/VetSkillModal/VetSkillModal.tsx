/* VetSkillModal — "Review & trust" (SPEC-02 AC-5, ADR 0012). Opened instead of
   enabling an unvetted skill directly: shows the raw source (invisible/bidi
   characters marked, HTML comments flagged — rendered markdown hides both) and
   a trust notice, then POSTs /skills/:id/vet before enabling it. Shared by the
   list card's Toggle and the Config tab's Enabled toggle — both live under
   app/skills/**, so this sits at the route's ancestor _components/ (ADR 0010). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { useVetSkill, useUpdateSkill } from "@/lib/hooks";
import { hasHtmlComment, splitInvisibleChars } from "../../helpers";
import { InvisibleCharSegments } from "../InvisibleCharSegments";
import { s } from "./styles";

export function VetSkillModal({
  skill,
  onClose,
  onVetted,
}: {
  skill: { id: string; name: string; body: string; version: number };
  onClose: () => void;
  /** Runs after vet + enable succeed — lets a form sync its local draft. */
  onVetted?: () => void;
}) {
  const t = useTranslations("skills");
  const tShell = useTranslations("shell");
  const vet = useVetSkill();
  const update = useUpdateSkill();
  const busy = vet.isPending || update.isPending;

  const confirm = async () => {
    try {
      await vet.mutateAsync({ id: skill.id, version: skill.version });
      await update.mutateAsync({ id: skill.id, patch: { enabled: true } });
    } catch {
      return; // the global MutationCache toast reports it (ADR 0011); keep the modal open
    }
    onVetted?.();
    onClose();
  };

  const segments = splitInvisibleChars(skill.body);
  const commented = hasHtmlComment(skill.body);

  return (
    <Modal
      width={640}
      title={t("vet.title")}
      closeLabel={tShell("ui.close")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("vet.cancel")}
          </Button>
          <Button kind="primary" icon="Check" onClick={confirm} disabled={busy}>
            {t("vet.confirm")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <p style={s.copy}>{t("vet.body", { name: skill.name })}</p>
        {commented && <div style={s.warning}>{t("preview.commentWarning")}</div>}
        <div style={s.sourceCaption}>{t("vet.sourceCaption")}</div>
        <pre className="mono" style={s.source}>
          <InvisibleCharSegments segments={segments} />
        </pre>
      </div>
    </Modal>
  );
}
