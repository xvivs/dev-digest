"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Disclosure, DisclosureChevron } from "@devdigest/ui";
import type { PrIntentRecord } from "@devdigest/shared";
import { RunCostValue } from "@/components/run-cost-value";
import { ICON_SIZE } from "../../../../constants";
import { s as shared } from "../../../../styles";
import { s } from "./styles";

/**
 * Closed-by-default "Details": the intent's sources, the links that were
 * recorded but never fetched, and the derivation cost. Text only, no anchors.
 */
export function IntentDetails({ intent }: { intent: PrIntentRecord }) {
  const t = useTranslations("brief");
  return (
    <Disclosure
      style={s.wrap}
      headerStyle={s.header}
      header={(open) => (
        <>
          <DisclosureChevron open={open} size={ICON_SIZE.inline} />
          <span>{t("details")}</span>
        </>
      )}
    >
      <div style={s.body}>
        <div>
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
          {t("intent.cost")} <RunCostValue usd={intent.cost_usd} source={intent.cost_source} />
        </div>
      </div>
    </Disclosure>
  );
}
