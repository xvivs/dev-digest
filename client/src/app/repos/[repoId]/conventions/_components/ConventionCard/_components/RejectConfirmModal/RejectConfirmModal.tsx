/* RejectConfirmModal — asks before rejecting a convention that already lives in
   a skill (AC-38). Skills are snapshots: the skill keeps the rule, so the dialog
   says so and links to each skill instead of silently leaving them out of sync. */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { skillHref } from "@/lib/routes";
import { MODAL_WIDTH } from "./constants";
import { s } from "./styles";

export function RejectConfirmModal({
  skills,
  onConfirm,
  onCancel,
}: {
  skills: readonly { id: string; name: string }[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("conventions");
  const tShell = useTranslations("shell");
  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("card.rejectConfirm.title")}
      closeLabel={tShell("ui.close")}
      onClose={onCancel}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onCancel}>
            {t("card.rejectConfirm.cancel")}
          </Button>
          <Button kind="danger" icon="X" onClick={onConfirm}>
            {t("card.rejectConfirm.confirm")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <p style={s.copy}>{t("card.rejectConfirm.body")}</p>
        <div style={s.usedIn}>{t("card.rejectConfirm.usedIn")}</div>
        <ul style={s.list}>
          {skills.map((skill) => (
            <li key={skill.id}>
              <Link href={skillHref(skill.id)} style={s.link} className="mono">
                {skill.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
