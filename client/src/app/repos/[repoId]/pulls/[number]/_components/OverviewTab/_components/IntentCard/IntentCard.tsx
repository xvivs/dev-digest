"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { useDeriveBrief, usePrIntent } from "@/lib/hooks";
import { BriefFailureNotice } from "../BriefFailureNotice";
import { IntentDetails } from "./_components/IntentDetails";
import { CONFIDENCE_COLOR, ICON_SIZE, STALE_COLOR, SKELETON_HEIGHT } from "../../constants";
import { shouldShowConfidenceBadge } from "../../helpers";
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
      <div style={shared.block}>
        {heading}
        <Skeleton height={SKELETON_HEIGHT.intent} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div style={shared.block}>
        {heading}
        <ErrorState title={t("error")} onRetry={() => refetch()} />
      </div>
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
      <div style={shared.block}>
        {heading}
        {emptyBody}
      </div>
    );
  }

  const low = intent.confidence === "low";
  const tone = CONFIDENCE_COLOR[intent.confidence];
  return (
    <div style={shared.block}>
      <SectionLabel
        icon="Target"
        right={
          <div style={shared.row}>
            {shouldShowConfidenceBadge(intent.confidence) && (
              <Badge color={tone.c} bg={tone.bg} style={s.confidenceBadge}>
                {t(`intent.confidence.${intent.confidence}`)}
              </Badge>
            )}
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
      <blockquote style={s.quote}>“{intent.intent}”</blockquote>
      {low && <p style={shared.muted}>{t("intent.lowHint")}</p>}

      <div style={s.scopes}>
        <ScopeList kind="in" label={t("intent.inScope")} items={intent.in_scope} empty={t("intent.empty")} />
        <ScopeList kind="out" label={t("intent.outOfScope")} items={intent.out_of_scope} empty={t("intent.empty")} />
      </div>

      <IntentDetails intent={intent} />
    </div>
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

function ScopeList({
  kind,
  label,
  items,
  empty,
}: {
  kind: "in" | "out";
  label: string;
  items: string[];
  empty: string;
}) {
  const HeadIcon = kind === "in" ? Icon.Check : Icon.X;
  const out = kind === "out";
  return (
    <div style={s.scope}>
      <div style={s.scopeHead(out)}>
        <HeadIcon size={ICON_SIZE.inline} aria-hidden="true" />
        <span>{label}</span>
      </div>
      {items.length === 0 ? (
        <div style={shared.muted}>{empty}</div>
      ) : (
        <ul style={s.list}>
          {items.map((item, i) => (
            <li key={`${i}-${item}`} style={s.item(out)}>
              <span aria-hidden="true" style={s.bullet}>·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
