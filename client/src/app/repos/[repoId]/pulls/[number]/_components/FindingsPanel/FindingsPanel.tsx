/* FindingsPanel — hide-low-confidence + severity filter + j/k navigation +
   FindingCard list, wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { countBySeverity } from "@/components/severity-icons";
import { FindingCard } from "../FindingCard";
import { SeverityFilterBar } from "../SeverityFilterBar";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { baseFindings, bySeverity } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  targetSeverity = null,
  targetNonce = 0,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Severity the Timeline asked this panel to focus on (null = show all). */
  targetSeverity?: Severity | null;
  /** Bumped by the Timeline on every click, so asking for the SAME severity
   *  twice still re-applies it. */
  targetNonce?: number;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);
  const [severity, setSeverity] = React.useState<Severity | null>(targetSeverity);

  // Timeline → panel hand-off, adjusted DURING RENDER (React's documented
  // pattern) rather than in an effect: an effect would paint one frame of the
  // unfiltered list first, and remounting via `key` would throw away the
  // hideLow toggle and the keyboard focus position the user had set.
  const [prevNonce, setPrevNonce] = React.useState(targetNonce);
  if (targetNonce !== prevNonce) {
    setPrevNonce(targetNonce);
    setSeverity(targetSeverity);
  }

  const base = React.useMemo(() => baseFindings(findings, { hideLow }), [findings, hideLow]);
  // INVARIANT: the counters are tallied from `base` — after hideLow, before the
  // severity filter — which is the same array the cards below are rendered
  // from. A pill's number always equals the number of cards selecting it shows.
  const counts = React.useMemo(() => countBySeverity(base), [base]);
  const shown = React.useMemo(() => bySeverity(base, severity), [base, severity]);

  // Filtering can shrink the list out from under a stale index — clamp on read
  // instead of storing a corrected copy.
  const focus = shown.length === 0 ? 0 : Math.min(focusIdx, shown.length - 1);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx(Math.min(focus + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx(Math.max(focus - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focus]) {
        action.mutate({ findingId: shown[focus]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focus, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <SeverityFilterBar counts={counts} value={severity} onChange={setSeverity} />
        <div style={s.divider} />
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focus}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
