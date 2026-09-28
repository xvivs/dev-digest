/* PRRow — one row in the PR list table. Ported from screen_dashboard.jsx.

   The title is a real `next/link`: it is the keyboard, middle-click and
   prefetch path. The rest of the row is a mouse-only convenience that pushes
   the same href. A stretched-link overlay (absolute span inside the link) was
   tried and dropped: agent-browser (e2e) cannot click an element whose box
   includes such an overlay. Interactive cells (FINDINGS) stop propagation, so
   a severity pick never also opens the PR. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore } from "@devdigest/ui";
import type { PrMeta } from "@devdigest/shared";
import { RunCostValue } from "@/components/run-cost-value";
import { PrFindingsCell } from "../PrFindingsCell";
import { DEFAULT_STATUS_META, SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const href = `/repos/${repoId}/pulls/${pr.number}`;
  // Hover OR keyboard focus inside the row: the focused link gets the same highlight.
  const [h, setH] = React.useState(false);
  const st = STATUS_META[pr.status] ?? DEFAULT_STATUS_META;
  const { size, lines } = sizeOf(pr);
  const sizeColor = SIZE_COLOR[size];
  const updated = relativeTime(pr.updated_at);
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onFocus={() => setH(true)}
      onBlur={() => setH(false)}
      onClick={(e) => {
        // The link navigates by itself; don't push the same route twice.
        if ((e.target as Element).closest("a, button")) return;
        router.push(href);
      }}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <Link href={href} style={s.rowTitle(h)}>
            {pr.title}
          </Link>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge color={sizeColor} bg="transparent" style={s.sizeBadgeBorder(sizeColor)}>
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {pr.score != null ? (
          <CircularScore score={pr.score} size={34} stroke={3} />
        ) : (
          // null score ⇒ the PR has never been reviewed
          <span style={s.muted}>{t("list.noValue")}</span>
        )}
      </div>
      <PrFindingsCell pr={pr} repoId={repoId} />
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div style={s.costCell}>
        <RunCostValue
          usd={pr.last_run_cost_usd}
          source={pr.last_run_cost_source}
          missingReason={pr.last_run_cost_missing_reason}
        />
      </div>
      <div style={s.updatedCell}>
        {updated
          ? t(`list.relative.${updated.unit}`, { value: updated.value })
          : t("list.noValue")}
      </div>
    </div>
  );
}
