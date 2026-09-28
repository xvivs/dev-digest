/* SkillCard — name (mono), type badge, source label, 2-line description, an
   enabled Toggle and N agents (SPEC-02 AC-1). Shared leaf: rendered by the
   /skills list and the /skills/:id editor's side list (ADR 0010 — both under
   the same route tree, so this sits at app/skills/_components/, not promoted).

   The skill name is a real <Link>: the keyboard, middle-click and prefetch
   path. The rest of the card is a mouse-only convenience that pushes the same
   href, gated by the dirty-form navigation guard (see ../../navigation-guard).
   Mirrors AgentCard (client/src/components/agent-card/AgentCard.tsx) — no
   stretched-link overlay, for the same agent-browser click reason. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import { Toggle } from "@devdigest/ui";
import type { SkillListItem } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks";
import { useNavigationGuard } from "../../navigation-guard";
import { VetSkillModal } from "../VetSkillModal";
import { TOGGLE_SIZE } from "./constants";
import { s } from "./styles";

export function SkillCard({
  skill,
  href,
  active,
}: {
  skill: SkillListItem;
  /** Where the card navigates. Omit for a static (non-navigating) card. */
  href?: string;
  active?: boolean;
}) {
  const t = useTranslations("skills");
  const router = useRouter();
  const guard = useNavigationGuard();
  const update = useUpdateSkill();
  const [vetting, setVetting] = React.useState(false);

  const onToggle = (next: boolean) => {
    // Turning ON an unvetted skill opens "Review & trust" instead (AC-5); the
    // modal itself calls vet + update. Turning off, or an already-vetted
    // skill, is a plain enable/disable.
    if (next && skill.needs_vetting) {
      setVetting(true);
      return;
    }
    update.mutate({ id: skill.id, patch: { enabled: next } });
  };

  return (
    <div
      style={s.card(!!active, skill.enabled, !!href)}
      onClick={(e) => {
        // The link, toggle and vet modal handle their own clicks.
        if (!href || (e.target as Element).closest("a, button, input, [role='switch']")) return;
        guard.confirmNavigation(() => router.push(href));
      }}
    >
      <div style={s.headerRow}>
        {href ? (
          <Link href={href} aria-current={active ? "page" : undefined} className="mono" style={s.nameLink}>
            {skill.name}
          </Link>
        ) : (
          <span className="mono" style={s.name}>
            {skill.name}
          </span>
        )}
        <Toggle
          on={skill.enabled}
          onChange={onToggle}
          size={TOGGLE_SIZE}
          label={t("card.enabledToggle", { name: skill.name })}
        />
      </div>
      <div style={s.description}>{skill.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <Badge color="var(--text-secondary)">{t(`type.${skill.type}`)}</Badge>
        <span style={s.sourceLabel}>{t(`source.${skill.source}`)}</span>
        <Badge color="var(--text-secondary)" icon="Users">
          {t("card.agentCount", { count: skill.agent_count })}
        </Badge>
        {skill.needs_vetting && (
          <span title={t("card.vettingTitle")}>
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("card.needsVetting")}
            </Badge>
          </span>
        )}
      </div>
      {vetting && <VetSkillModal skill={skill} onClose={() => setVetting(false)} />}
    </div>
  );
}
