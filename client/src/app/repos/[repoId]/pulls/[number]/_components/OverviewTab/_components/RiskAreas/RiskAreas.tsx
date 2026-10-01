"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Icon, SectionLabel, Skeleton, VisuallyHidden } from "@devdigest/ui";
import type { Risk } from "@devdigest/shared";
import { useDeriveBrief, usePrRisks } from "@/lib/hooks";
import { RunCostValue } from "@/components/run-cost-value";
import { BriefFailureNotice } from "../BriefFailureNotice";
import { RISK_ICON, RISK_SEVERITY_COLOR, ICON_SIZE, SKELETON_HEIGHT} from "../../constants";
import { splitInlineCode } from "../../helpers";
import { s as shared } from "../../styles";
import { s } from "./styles";

/** Risk areas: one pill per risk; clicking a pill toggles its detail. Text only. */
export function RiskAreas({ prId }: { prId: string }) {
  const t = useTranslations("brief");
  const { data, isLoading, isError, refetch } = usePrRisks(prId);
  const derive = useDeriveBrief(prId);
  const [openKey, setOpenKey] = React.useState<string | null>(null);

  const heading = <SectionLabel icon="Shield">{t("block.risks")}</SectionLabel>;

  if (isLoading) {
    return (
      <div style={shared.block}>
        {heading}
        <Skeleton height={SKELETON_HEIGHT.list} />
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

  const { risks: record, in_flight: inFlight, last_failure: failure } = data;
  const busy = inFlight || derive.isPending;

  if (!record) {
    let emptyBody: React.ReactNode;
    if (inFlight) {
      emptyBody = (
        <div style={shared.muted} role="status">
          {t("deriving")}
        </div>
      );
    } else if (failure) {
      emptyBody = (
        <BriefFailureNotice
          prId={prId}
          reason={failure.reason}
          deriveLabel={t("derive")}
          busy={busy}
          onDerive={() => derive.mutate()}
        />
      );
    } else {
      emptyBody = (
        <EmptyState icon="Shield" title={t("unavailable")} body={t("unavailableHint")} cta={t("derive")} onCta={() => derive.mutate()} ctaLoading={busy} />
      );
    }
    return (
      <div style={shared.block}>
        {heading}
        {emptyBody}
      </div>
    );
  }

  const keyOf = (r: Risk, i: number) => `${i}:${r.kind}:${r.title}`;
  const open = record.risks.find((r, i) => keyOf(r, i) === openKey);

  return (
    <div style={shared.block}>
      {heading}
      {inFlight && (
        <div style={shared.muted} role="status">
          {t("deriving")}
        </div>
      )}
      {record.rule_only && <div style={s.ruleOnly}>{t("risks.ruleOnly")}</div>}

      {record.risks.length === 0 ? (
        <div style={shared.muted}>{t("noRisks")}</div>
      ) : (
        <>
          <div style={s.pills}>
            {record.risks.map((r, i) => {
              const k = keyOf(r, i);
              const tone = RISK_SEVERITY_COLOR[r.severity];
              const PillIcon = Icon[RISK_ICON[r.kind]];
              return (
                <button
                  key={k}
                  type="button"
                  aria-expanded={openKey === k}
                  onClick={() => setOpenKey(openKey === k ? null : k)}
                  style={s.pill(openKey === k)}
                >
                  <PillIcon size={ICON_SIZE.inline} aria-hidden="true" style={s.pillIcon(tone.c)} />
                  <span>{r.title}</span>
                  {" "}
                  <VisuallyHidden>{t(`risks.severity.${r.severity}`)}</VisuallyHidden>
                </button>
              );
            })}
          </div>
          {open && (
            <div style={s.detail}>
              <div style={shared.row}>
                <Badge>{t(`risks.kind.${open.kind}`)}</Badge>
              </div>
              <p style={s.explanation}>
                {splitInlineCode(open.explanation).map((seg, i) =>
                  seg.code ? (
                    <code key={i} style={shared.code}>
                      {seg.text}
                    </code>
                  ) : (
                    <React.Fragment key={i}>{seg.text}</React.Fragment>
                  ),
                )}
              </p>
              {open.file_refs.length > 0 && (
                <ul style={s.refs}>
                  {open.file_refs.map((ref, i) => (
                    <li key={`${i}-${ref}`} style={shared.mono}>
                      {ref}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <div style={s.footer}>
        {record.dropped_refs > 0 && <span>{t("risks.droppedRefs", { count: record.dropped_refs })}</span>}
        <span>
          {t("risks.cost")} <RunCostValue usd={record.cost_usd} source={record.cost_source} />
        </span>
      </div>
    </div>
  );
}
