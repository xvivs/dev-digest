/* SkillCard — name (mono), type badge, source label, 2-line description, an
   enabled Toggle and the "N agents · M runs · verdict" line (SPEC-02 AC-1,
   skill-impact decision 3: runs are the last 30 days, the verdict is the
   latest Full eval, "no evals" when there is none). Shared leaf: rendered by the
   /skills list and the /skills/:id editor's side list (ADR 0010 — both under
   the same route tree, so this sits at app/skills/_components/, not promoted).

   The skill name is a real <Link>: the keyboard, middle-click and prefetch
   path. A plain same-tab click on it, and on the rest of the card, pushes the
   href through the dirty-form navigation guard (see ../../navigation-guard).
   Mirrors AgentCard (client/src/app/agents/_components/AgentCard/AgentCard.tsx) — no
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
import { VerdictBadge } from "../VerdictBadge";
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

  // The vet modal renders as a SIBLING of the card: a disabled card is dimmed
  // with `opacity`, which would otherwise make the whole modal translucent,
  // and clicks inside it would bubble into the card's navigate handler.
  return (
    <>
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
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className="mono"
              style={s.nameLink}
              onClick={(e) => {
                // New-tab/window opens stay native; a same-tab navigation
                // goes through the dirty-form guard like the card body (AC-8).
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                guard.confirmNavigation(() => router.push(href));
              }}
            >
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
          <SkillCardStats skill={skill} />
          {skill.needs_vetting && (
            <span title={t("card.vettingTitle")}>
              <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                {t("card.needsVetting")}
              </Badge>
            </span>
          )}
        </div>
      </div>
      {vetting && <VetSkillModal skill={skill} onClose={() => setVetting(false)} />}
    </>
  );
}

/**
 * `3 agents · 142 runs · ✓ Helps` / `· no evals` / `· Helps · stale`.
 * `runs_30d` and `latest_verdict` are optional on the contract only so that
 * pre-skill-impact payloads parse: `undefined` leaves the segment out, while
 * `latest_verdict: null` is a real answer ("no evals").
 */
function SkillCardStats({ skill }: { skill: SkillListItem }) {
  const t = useTranslations("skills");
  const verdict = skill.latest_verdict;
  return (
    <span role="group" aria-label={t("card.statsLabel")} style={s.stats}>
      <span>{t("card.agentCount", { count: skill.agent_count })}</span>
      {skill.runs_30d !== undefined && (
        <>
          <span aria-hidden="true">·</span>
          <span title={t("card.runsTitle")}>{t("card.runs", { count: skill.runs_30d })}</span>
        </>
      )}
      {verdict !== undefined && (
        <>
          <span aria-hidden="true">·</span>
          {verdict === null ? (
            <span title={t("card.noEvalsTitle")}>{t("card.noEvals")}</span>
          ) : (
            <VerdictBadge
              verdict={verdict.verdict}
              stale={verdict.stale}
              title={t("card.verdictTitle", { carrier: verdict.carrier_name })}
            />
          )}
        </>
      )}
    </span>
  );
}
