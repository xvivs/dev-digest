"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { useDeriveBrief, usePrIntent } from "@/lib/hooks";
import { RunCostValue } from "@/components/run-cost-value";
import { BriefFailureNotice } from "../BriefFailureNotice";
import { CONFIDENCE_COLOR, STALE_COLOR } from "../../constants";
import { s as shared } from "../../styles";
import { s } from "./styles";

/**
 * Derived intent: quote, scope lists, confidence, sources and the links that
 * were recorded but never fetched. Every string is model- or PR-derived and is
 * rendered as JSX text only (no markdown, no href).
 */
export function IntentCard({ prId }: { prId: string }) {
  const t = useTranslations("brief");
  const { data, isLoading, isError, refetch } = usePrIntent(prId);
  const derive = useDeriveBrief(prId);

  const heading = <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>;

  if (isLoading) {
    return (
      <section style={shared.card}>
        {heading}
        <Skeleton height={64} />
      </section>
    );
  }
  if (isError || !data) {
    return (
      <section style={shared.card}>
        {heading}
        <ErrorState title={t("error")} onRetry={() => refetch()} />
      </section>
    );
  }

  const { intent, stale, in_flight: inFlight, last_failure: failure } = data;
  const busy = inFlight || derive.isPending;
  const failureNotice = failure && !inFlight && (
    <BriefFailureNotice
      prId={prId}
      reason={failure.reason}
      deriveLabel={intent ? t("refresh") : t("derive")}
      busy={busy}
      onDerive={() => derive.mutate()}
    />
  );

  if (!intent) {
    let emptyBody: React.ReactNode;
    if (inFlight) {
      emptyBody = (
        <div style={shared.muted} role="status">
          {t("deriving")}
        </div>
      );
    } else if (failureNotice) {
      emptyBody = failureNotice;
    } else {
      emptyBody = (
        <EmptyState icon="Target" title={t("unavailable")} body={t("unavailableHint")} cta={t("derive")} onCta={() => derive.mutate()} ctaLoading={busy} />
      );
    }
    return (
      <section style={shared.card}>
        {heading}
        {emptyBody}
      </section>
    );
  }

  const low = intent.confidence === "low";
  const tone = CONFIDENCE_COLOR[intent.confidence];
  return (
    <section style={low ? s.lowCard : shared.card}>
      <SectionLabel
        icon="Target"
        right={
          <div style={shared.row}>
            <Badge color={tone.c} bg={tone.bg}>
              {t(`intent.confidence.${intent.confidence}`)}
            </Badge>
            {stale && <Badge color={STALE_COLOR.c} bg={STALE_COLOR.bg}>{t("stale")}</Badge>}
            {stale && !failure && <DeriveButton busy={busy} label={t("refresh")} onClick={() => derive.mutate()} />}
          </div>
        }
      >
        {t("block.intent")}
      </SectionLabel>

      {inFlight && (
        <div style={shared.muted} role="status">
          {t("deriving")}
        </div>
      )}
      {failureNotice}
      <blockquote style={s.quote}>{intent.intent}</blockquote>
      {low && <p style={shared.muted}>{t("intent.lowHint")}</p>}

      <div style={s.scopes}>
        <ScopeList label={t("intent.inScope")} items={intent.in_scope} empty={t("intent.empty")} />
        <ScopeList label={t("intent.outOfScope")} items={intent.out_of_scope} empty={t("intent.empty")} />
      </div>

      <div style={s.meta}>
        <div style={s.metaLabel}>{t("intent.sources")}</div>
        <ul style={s.list}>
          {intent.sources.map((src, i) => (
            <li key={`${src.kind}-${src.ref ?? ""}-${i}`} style={shared.row}>
              <Badge>{t(`intent.source.${src.kind}`)}</Badge>
              {src.ref && <span style={shared.mono}>{src.ref}</span>}
            </li>
          ))}
        </ul>
      </div>

      {intent.unresolved_links.length > 0 && (
        <div style={s.meta}>
          <div style={s.metaLabel}>{t("intent.unresolved")}</div>
          <ul style={s.list}>
            {intent.unresolved_links.map((l, i) => (
              <li key={`${l.url}-${i}`} style={shared.row}>
                {/* PR-author text: shown as plain text, never an anchor. */}
                <span style={shared.mono}>{l.url}</span>
                <span style={shared.muted}>{t(`intent.unresolvedReason.${l.reason}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={s.costLine}>
        {t("intent.cost")}{" "}
        <RunCostValue usd={intent.cost_usd} source={intent.cost_source} />
      </div>
    </section>
  );
}

function DeriveButton({ busy, label, onClick }: { busy: boolean; label: string; onClick: () => void }) {
  const t = useTranslations("brief");
  return (
    <Button kind="secondary" size="sm" icon="Sparkles" loading={busy} disabled={busy} onClick={onClick}>
      {busy ? t("deriving") : label}
    </Button>
  );
}

function ScopeList({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return (
    <div style={s.scope}>
      <div style={s.metaLabel}>{label}</div>
      {items.length === 0 ? (
        <div style={shared.muted}>{empty}</div>
      ) : (
        <ul style={s.list}>
          {items.map((item, i) => (
            <li key={`${i}-${item}`} style={s.item}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
