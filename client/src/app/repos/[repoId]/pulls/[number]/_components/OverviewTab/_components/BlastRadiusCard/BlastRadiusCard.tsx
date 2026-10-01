"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrBlast } from "@/lib/hooks";
import { BLAST_STAT_ICON, BLAST_VIEWS, ICON_SIZE, SKELETON_HEIGHT, type BlastView } from "../../constants";
import { blastStats } from "../../helpers";
import { s as shared } from "../../styles";
import { BlastTree } from "./_components/BlastTree";
import { BlastGraph } from "./_components/BlastGraph";
import { s } from "./styles";

function ViewToggle({ label, active, onSelect }: { label: string; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onSelect} style={s.toggleBtn(active)}>
      {label}
    </button>
  );
}

/** Downstream impact of the changed symbols: stats + tree/graph views. */
export function BlastRadiusCard({ prId }: { prId: string }) {
  const t = useTranslations("blast");
  const tb = useTranslations("brief");
  const [view, setView] = React.useState<BlastView>("tree");
  const { data, isLoading, isError, refetch } = usePrBlast(prId);

  const heading = <SectionLabel icon="Workflow">{tb("block.blast")}</SectionLabel>;

  if (isLoading) {
    return (
      <div style={shared.block}>
        {heading}
        <Skeleton height={SKELETON_HEIGHT.blast} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div style={shared.block}>
        {heading}
        <ErrorState title={t("state.error")} onRetry={() => refetch()} />
      </div>
    );
  }
  if (data.status === "unavailable" || !data.blast) {
    return (
      <div style={shared.block}>
        {heading}
        <EmptyState
          icon="Workflow"
          title={t("state.unavailable")}
          body={data.reason ? t(`reason.${data.reason}`) : undefined}
        />
      </div>
    );
  }

  const { blast } = data;
  const stats = blastStats(blast);
  const statItems = [
    { key: "symbols", value: stats.symbols },
    { key: "callers", value: stats.callers },
    { key: "endpoints", value: stats.endpoints },
    { key: "crons", value: stats.crons },
  ] as const;

  let graphBody: React.ReactNode;
  if (blast.downstream.length === 0) {
    graphBody = <div style={shared.muted}>{t("noDownstream", { count: stats.symbols })}</div>;
  } else if (view === "tree") {
    graphBody = <BlastTree downstream={blast.downstream} />;
  } else {
    graphBody = <BlastGraph downstream={blast.downstream} />;
  }

  return (
    <div style={shared.block}>
      {heading}

      {data.status === "degraded" && (
        <div style={s.notice} role="status">
          <Icon.AlertTriangle size={ICON_SIZE.section} aria-hidden="true" />
          <span>
            {t("state.degraded")}
            {data.reason ? ` ${t(`reason.${data.reason}`)}` : ""}
          </span>
        </div>
      )}
      {data.truncated && <div style={s.truncated}>{t("truncated")}</div>}

      <div style={s.statsRow}>
        <div style={s.stats}>
          {statItems.map((st) => {
            const StatIcon = Icon[BLAST_STAT_ICON[st.key]];
            return (
              <div key={st.key} style={s.stat}>
                <StatIcon size={ICON_SIZE.inline} aria-hidden="true" style={s.statIcon} />
                <span style={s.statValue}>{st.value}</span>
                <span style={s.statLabel}>{t(`stat.${st.key}`)}</span>
              </div>
            );
          })}
        </div>
        <div style={s.toggle} role="group" aria-label={tb("block.blast")}>
          {BLAST_VIEWS.map((v) => (
            <ViewToggle key={v} label={t(`view.${v}`)} active={view === v} onSelect={() => setView(v)} />
          ))}
        </div>
      </div>

      {graphBody}

      {data.source_sha && (
        <div style={s.basedOn}>
          <Badge mono>{t("basedOnIndex", { sha: data.source_sha.slice(0, 7) })}</Badge>
        </div>
      )}
    </div>
  );
}
