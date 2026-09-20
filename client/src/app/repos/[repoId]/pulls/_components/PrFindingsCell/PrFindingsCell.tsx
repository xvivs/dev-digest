/**
 * PrFindingsCell — the FINDINGS column of one PR list row.
 *
 * Renders the severity tally the list endpoint already ships on `PrMeta`
 * (`last_review_findings`), so the column costs zero extra requests on page
 * load. The per-finding preview behind the popover is fetched lazily: the row
 * only asks for it once the popover's own open timer fires (`onArm`), which
 * keeps a mouse sweeping down the table from firing one request per row.
 */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PrMeta, Severity } from "@devdigest/shared";
import { SeverityIcons } from "@/components/severity-icons";
import { FindingsPopover } from "@/components/findings-popover";
import { usePrReviews } from "@/lib/hooks";
import { s } from "../../styles";

export function PrFindingsCell({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("findings");
  const router = useRouter();

  // Armed by the popover, not by the bare hover — see `onArm` below.
  const [armed, setArmed] = React.useState(false);
  const { data: reviews, isFetching, isError } = usePrReviews(pr.id, { enabled: armed });

  // Both children are memoised (`SeverityIcons` is a `React.memo`), and the PR
  // list re-polls every 60s — a fresh closure per render would defeat that.
  const arm = React.useCallback(() => setArmed(true), []);
  const selectSeverity = React.useCallback(
    (severity: Severity) => {
      router.push(`/repos/${repoId}/pulls/${pr.number}?tab=findings&severity=${severity}`);
    },
    [router, repoId, pr.number],
  );

  const counts = pr.last_review_findings ?? null;
  const total = counts ? counts.critical + counts.warning + counts.suggestion : 0;

  // `GET /pulls/:id/reviews` returns BOTH kinds (`summary` and `review`) and does
  // not order by kind, so `reviews[0]` can be a summary row with no findings.
  // The counts on `PrMeta` are anchored to the newest `kind: 'review'` — anchor
  // the preview to the same row or the icons and the popover disagree.
  const review = reviews?.find((r) => r.kind === "review");

  // `last_review_findings` is null until the PR has been reviewed at all; an
  // all-zero tally means "reviewed, nothing found". Both read as a plain dash,
  // and neither is worth a popover.
  if (counts == null || total === 0) {
    return (
      <div style={s.findingsCell}>
        <span style={s.muted}>{t("cell.none")}</span>
      </div>
    );
  }

  return (
    // The row itself navigates on click; the cell owns its own interactions, so
    // it swallows the click rather than letting the row hijack a severity pick.
    <div style={s.findingsCell} onClick={(e) => e.stopPropagation()}>
      <FindingsPopover
        total={total}
        findings={review?.findings}
        // `isFetching`, not `isPending`: a query held at `enabled: false` stays
        // `isPending` forever in TanStack v5, which would show a spinner on a
        // popover that has not asked for anything yet.
        loading={isFetching}
        error={isError}
        runLinked={review?.run_id != null}
        onArm={arm}
      >
        <SeverityIcons counts={counts} onSelect={selectSeverity} />
      </FindingsPopover>
    </div>
  );
}
