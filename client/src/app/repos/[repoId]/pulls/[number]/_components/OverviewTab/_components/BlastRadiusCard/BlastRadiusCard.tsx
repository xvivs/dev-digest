"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrBlast } from "@/lib/hooks";
import { BLAST_VIEWS, type BlastView } from "../../constants";
import { blastStats } from "../../helpers";
import { s as shared } from "../../styles";
import { BlastTree } from "./_components/BlastTree";
import { BlastGraph } from "./_components/BlastGraph";
import { s } from "./styles";

/** Downstream impact of the changed symbols: stats + tree/graph views. */
export function BlastRadiusCard({ prId }: { prId: string }) {
  const t = useTranslations("blast");
  const tb = useTranslations("brief");
  const [view, setView] = React.useState<BlastView>("tree");
  const { data, isLoading, isError, refetch } = usePrBlast(prId);

  const heading = <SectionLabel icon="Workflow">{tb("block.blast")}</SectionLabel>;

  if (isLoading) {
    return (
      <section style={shared.card}>
        {heading}
        <Skeleton height={80} />
      </section>
    );
  }
  if (isError || !data) {
    return (
      <section style={shared.card}>
        {heading}
        <ErrorState title={t("state.error")} onRetry={() => refetch()} />
      </section>
    );
  }
  if (data.status === "unavailable" || !data.blast) {
    return (
      <section style={shared.card}>
        {heading}
        <EmptyState
          icon="Workflow"
          title={t("state.unavailable")}
          body={data.reason ? t(`reason.${data.reason}`) : undefined}
        />
      </section>
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

  return (
    <section style={shared.card}>
      <SectionLabel
        icon="Workflow"
        right={
          <div style={s.toggle} role="group" aria-label={tb("block.blast")}>
            {BLAST_VIEWS.map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} style={s.toggleBtn(view === v)}>
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
        }
      >
        {tb("block.blast")}
      </SectionLabel>

      {data.status === "degraded" && (
        <div style={s.notice} role="status">
          <Icon.AlertTriangle size={15} aria-hidden="true" />
          <span>
            {t("state.degraded")}
            {data.reason ? ` ${t(`reason.${data.reason}`)}` : ""}
          </span>
        </div>
      )}
      {data.truncated && <div style={s.truncated}>{t("truncated")}</div>}

      <div style={s.stats}>
        {statItems.map((st) => (
          <div key={st.key} style={s.stat}>
            <span style={s.statValue}>{st.value}</span>
            <span style={shared.muted}>{t(`stat.${st.key}`)}</span>
          </div>
        ))}
      </div>

      {blast.downstream.length === 0 ? (
        <div style={shared.muted}>{t("noDownstream", { count: stats.symbols })}</div>
      ) : view === "tree" ? (
        <BlastTree downstream={blast.downstream} />
      ) : (
        <BlastGraph downstream={blast.downstream} />
      )}

      {data.source_sha && (
        <div style={s.basedOn}>
          <Badge mono>{t("basedOnIndex", { sha: data.source_sha.slice(0, 7) })}</Badge>
        </div>
      )}
    </section>
  );
}
