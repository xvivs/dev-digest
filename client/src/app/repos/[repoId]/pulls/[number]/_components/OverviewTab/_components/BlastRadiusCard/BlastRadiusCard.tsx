"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrBlast } from "@/lib/hooks";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { BLAST_STAT_ICON, BLAST_VIEWS, ICON_SIZE, SKELETON_HEIGHT, type BlastView } from "../../constants";
import { blastStats, canResyncBlast, hasNoCallers } from "../../helpers";
import { s as shared } from "../../styles";
import { BlastTree } from "./_components/BlastTree";
import { BlastGraph } from "./_components/BlastGraph";
import { ScrollFadeRegion } from "./_components/ScrollFadeRegion";
import { s } from "./styles";

function ViewToggle({ label, active, onSelect }: { label: string; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onSelect} style={s.toggleBtn(active)}>
      {label}
    </button>
  );
}

/** Downstream impact of the changed symbols: stats + tree/graph views. */
export interface BlastRadiusCardProps {
  prId: string;
  repoId: string;
  /** `owner/name`; null → caller paths render as plain text. */
  repoFullName: string | null;
}

export function BlastRadiusCard({ prId, repoId, repoFullName }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const tb = useTranslations("brief");
  const [view, setView] = React.useState<BlastView>("tree");
  const { data, isLoading, isError, refetch } = usePrBlast(prId);
  const resync = useResyncRepoIntel(repoId, { prId });

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
  const noCallers = hasNoCallers(blast);
  if (noCallers) {
    graphBody = <div style={shared.muted}>{t("noDownstream", { count: stats.symbols })}</div>;
  } else if (view === "tree") {
    graphBody = <BlastTree downstream={blast.downstream} repoFullName={repoFullName} sourceSha={data.source_sha} />;
  } else {
    graphBody = <BlastGraph downstream={blast.downstream} repoFullName={repoFullName} sourceSha={data.source_sha} />;
  }
  if (!noCallers) {
    // Only the list scrolls; heading, notices, stats and the view toggle stay outside. Focusable so arrow keys scroll it.
    graphBody = (
      <ScrollFadeRegion label={t("scrollRegion")}>{graphBody}</ScrollFadeRegion>
    );
  }

  return (
    <div style={shared.block}>
      {heading}

      {data.status === "degraded" && (
        <div style={s.degradedRow} role="status">
          <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)" style={s.degradedBadge}>
            {t("state.degraded")}
            {data.reason ? ` ${t(`reason.${data.reason}`)}` : ""}
          </Badge>
          {canResyncBlast(data.status, data.reason) && (
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              loading={resync.isPending}
              disabled={resync.isPending}
              onClick={() => resync.mutate()}
            >
              {resync.isPending ? t("resyncing") : t("resync")}
            </Button>
          )}
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
                <span style={s.statLabel}>{t(`stat.${st.key}`, { count: st.value })}</span>
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
