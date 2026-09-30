/* StatsTab — Usage + Cost + Impact for one skill (plan Phase 2, ADR 0017).
   Order: window switcher → Impact → Usage → Cost → By version. No category
   donut: findings are not attributed to a skill yet. The window lives in
   `?window=` (owned by SkillEditorView), so a reload or a shared link keeps
   it. Switching windows keeps the previous numbers on screen, dimmed, until
   the new ones arrive. The tab holds no draft, so it never reports dirty. */
"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, Card, ErrorState, MetricCard, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Skill, SkillStats, SkillStatsWindow } from "@devdigest/shared";
import { useSkillStats } from "@/lib/hooks";
import { RunCostValue } from "@/components/run-cost-value";
import { ImpactCard } from "./_components/ImpactCard";
import { SKELETON_CARDS, SKELETON_CARD_HEIGHT, STATS_WINDOWS, USAGE_STATUS_LOOK } from "./constants";
import { agentSkillsHref, costMissingReason, sortAgentsByRuns, sortVersionsDesc } from "./helpers";
import { s, windowButton } from "./styles";

export function StatsTab({
  skill,
  window,
  onWindowChange,
  onRunEvals,
}: {
  skill: Skill;
  window: SkillStatsWindow;
  onWindowChange: (w: SkillStatsWindow) => void;
  /** Impact CTA: open the Evals tab. */
  onRunEvals: () => void;
}) {
  const t = useTranslations("skills");
  const stats = useSkillStats(skill.id, window);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h2 style={s.title}>{t("stats.title")}</h2>
          <p style={s.caption}>{t("stats.caption")}</p>
        </div>
        <div role="group" aria-label={t("stats.window.label")} style={s.group}>
          {STATS_WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={w === window}
              title={t(`stats.window.${w}Title`)}
              onClick={() => w !== window && onWindowChange(w)}
              style={windowButton(w === window)}
            >
              {t(`stats.window.${w}`)}
            </button>
          ))}
        </div>
      </div>

      {stats.isLoading ? (
        <div style={s.skeleton}>
          {Array.from({ length: SKELETON_CARDS }, (_, i) => (
            <Skeleton key={i} height={SKELETON_CARD_HEIGHT} />
          ))}
        </div>
      ) : stats.isError || !stats.data ? (
        <ErrorState title={t("stats.loadError")} onRetry={() => stats.refetch()} />
      ) : (
        <div aria-busy={stats.isPlaceholderData} style={s.sections(stats.isPlaceholderData)}>
          <ImpactCard impact={stats.data.impact} onRunEvals={onRunEvals} />
          <UsageSection usage={stats.data.usage} />
          <CostSection cost={stats.data.cost} />
          <ByVersionSection rows={stats.data.by_version} currentVersion={skill.version} />
        </div>
      )}
    </div>
  );
}

function UsageSection({ usage }: { usage: SkillStats["usage"] }) {
  const t = useTranslations("skills");
  const format = useFormatter();
  const effective = usage.agents.filter((a) => a.status === "effective").length;
  return (
    <Card>
      <SectionLabel icon="Users">{t("stats.usage.title")}</SectionLabel>
      <div style={s.metrics}>
        <MetricCard label={t("stats.usage.runs")} value={format.number(usage.runs)} />
        <MetricCard
          label={t("stats.usage.effectiveAgents")}
          value={t("stats.usage.effectiveOf", { effective, total: usage.agents.length })}
        />
      </div>
      {usage.agents.length === 0 ? (
        <p style={s.empty}>{t("stats.usage.noAgents")}</p>
      ) : (
        <table aria-label={t("stats.usage.agentsLabel")} style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>{t("stats.usage.agent")}</th>
              <th style={s.th}>{t("stats.usage.status")}</th>
              <th style={s.thNum}>{t("stats.usage.agentRuns")}</th>
            </tr>
          </thead>
          <tbody>
            {sortAgentsByRuns(usage.agents).map((a) => {
              const look = USAGE_STATUS_LOOK[a.status];
              return (
                <tr key={a.agent_id}>
                  <td style={s.td}>
                    <Link href={agentSkillsHref(a.agent_id)} style={s.agentLink}>
                      {a.agent_name}
                    </Link>
                  </td>
                  <td style={s.td}>
                    <span title={t(`stats.usage.statusTitles.${a.status}`)}>
                      <Badge color={look.color} bg={look.bg} icon={look.icon}>
                        {t(`stats.usage.statuses.${a.status}`)}
                      </Badge>
                    </span>
                  </td>
                  <td style={s.tdNum}>{format.number(a.runs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function CostSection({ cost }: { cost: SkillStats["cost"] }) {
  const t = useTranslations("skills");
  const format = useFormatter();
  return (
    <Card>
      <SectionLabel icon="DollarSign">{t("stats.cost.title")}</SectionLabel>
      <p style={s.sectionCaption}>{t("stats.cost.caption")}</p>
      <div style={s.metrics}>
        <MetricCard label={t("stats.cost.tokens")} value={format.number(cost.tokens)} />
        <MetricCard
          label={t("stats.cost.cost")}
          value={
            <RunCostValue
              usd={cost.cost_usd}
              source={cost.cost_source}
              missingReason={costMissingReason(cost.cost_usd, cost.tokens)}
            />
          }
        />
      </div>
    </Card>
  );
}

function ByVersionSection({ rows, currentVersion }: { rows: SkillStats["by_version"]; currentVersion: number }) {
  const t = useTranslations("skills");
  const format = useFormatter();
  return (
    <Card>
      <SectionLabel icon="History">{t("stats.byVersion.title")}</SectionLabel>
      {rows.length === 0 ? (
        <p style={s.empty}>{t("stats.byVersion.empty")}</p>
      ) : (
        <table aria-label={t("stats.byVersion.label")} style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>{t("stats.byVersion.version")}</th>
              <th style={s.thNum}>{t("stats.byVersion.runs")}</th>
              <th style={s.thNum}>{t("stats.byVersion.tokens")}</th>
              <th style={s.thNum}>{t("stats.byVersion.cost")}</th>
            </tr>
          </thead>
          <tbody>
            {sortVersionsDesc(rows).map((r) => (
              <tr key={r.version}>
                <td style={s.td}>
                  <span style={s.versionCell}>
                    <Badge mono>{t("versions.label", { version: r.version })}</Badge>
                    {r.version === currentVersion && <span style={s.current}>{t("stats.byVersion.current")}</span>}
                  </span>
                </td>
                <td style={s.tdNum}>{format.number(r.runs)}</td>
                <td style={s.tdNum}>{format.number(r.tokens)}</td>
                <td style={s.tdNum}>
                  <RunCostValue usd={r.cost_usd} source={r.cost_source} missingReason={costMissingReason(r.cost_usd, r.tokens)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
