/* SuccessPanel — what the modal shows once the skill exists (AC-48, D11, V14).
   It replaces an action toast: a toast auto-dismisses, which fails
   accessibility for people who need longer to reach its links. The panel stays
   until the person dismisses the dialog. */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { agentSkillsHref, skillHref } from "@/lib/routes";
import { s } from "./styles";

export function SuccessPanel({
  skill,
  linkedAgents,
}: {
  skill: { id: string; name: string };
  linkedAgents: readonly { id: string; name: string }[];
}) {
  const t = useTranslations("conventions");
  return (
    <div style={s.wrap} role="status">
      <div style={s.badge} aria-hidden>
        <Icon.CheckCircle size={22} />
      </div>
      <div style={s.title}>{t("modal.success.title")}</div>
      <p style={s.copy}>
        {t("modal.success.body", { name: skill.name })}
        {linkedAgents.length > 0 && ` ${t("modal.success.linked", { count: linkedAgents.length })}`}
      </p>
      <div style={s.actions}>
        <Link href={skillHref(skill.id)} style={s.link(true)}>
          {t("modal.success.openSkill")}
        </Link>
        {linkedAgents.map((agent) => (
          <Link key={agent.id} href={agentSkillsHref(agent.id)} style={s.link(false)}>
            {t("modal.success.openAgent", { name: agent.name })}
          </Link>
        ))}
      </div>
    </div>
  );
}
