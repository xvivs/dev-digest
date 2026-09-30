"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, Button, Tabs, usePrefersReducedMotion } from "@devdigest/ui";
import type { PrDetail } from "@/lib/types";
import { STATUS_META } from "@/app/repos/[repoId]/pulls/constants";
import type { PrTab } from "@/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/constants";
import type { HeaderLayout } from "@/app/repos/[repoId]/pulls/[number]/constants";
import { RunReviewDropdown } from "../RunReviewDropdown";
import { CondensedBar } from "./_components/CondensedBar";
import { isSettledPr } from "./helpers";
import { s } from "./styles";

export interface PrDetailHeaderProps {
  /** Root element ref (React 19 ref-as-prop); PrDetailContent measures it for sticky offsets. */
  ref?: React.Ref<HTMLDivElement>;
  /** Ref for the 1px marker at the header's bottom edge (the condensing observer). */
  sentinelRef?: React.Ref<HTMLDivElement>;
  pr: PrDetail;
  prId: string | null;
  tab: PrTab;
  findingsCount: number;
  /** github.com PR URL; null when the repo's full_name isn't known yet. */
  githubUrl?: string | null;
  onSetTab: (tab: PrTab) => void;
  /** Fired the moment a review is kicked off (the page switches to the runs tab). */
  onRunStart: () => void;
  /** desktop: sticky header. mobile: header scrolls with the content. condensed: it has scrolled away, the bar is pinned. */
  layout?: HeaderLayout;
}

/** Marks the full header so focus inside it can follow it into the bar. */
const FULL_HEADER_ATTR = "data-pr-header-full";

export function PrDetailHeader({
  ref,
  sentinelRef,
  pr,
  prId,
  tab,
  findingsCount,
  githubUrl,
  onSetTab,
  onRunStart,
  layout = "desktop",
}: PrDetailHeaderProps) {
  const t = useTranslations("prReview");
  const status = STATUS_META[pr.status];
  const settled = isSettledPr(pr.status);
  const reducedMotion = usePrefersReducedMotion();
  const small = layout !== "desktop";
  const condensed = layout === "condensed";
  const barTitle = React.useRef<HTMLButtonElement>(null);

  // When the full header scrolls away with focus inside it, hand focus to the
  // bar's title instead of dropping it on <body>. Only on the transition, so
  // nothing is focused on mount. Layout effect: the bar is un-inerted by now.
  React.useLayoutEffect(() => {
    if (!condensed) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(`[${FULL_HEADER_ATTR}]`)) barTitle.current?.focus();
  }, [condensed]);

  const scrollToTop = (e: React.MouseEvent<HTMLElement>) =>
    e.currentTarget.closest("main")?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });

  const githubLabel = t("detail.viewOnGithub");
  const tabs = (
    <Tabs
      value={tab}
      // Tabs is a generic string-keyed primitive; the keys below are always
      // one of PR_TABS, so the cast back to PrTab is safe.
      onChange={(k) => onSetTab(k as PrTab)}
      pad="0"
      tabs={[
        { key: "overview", label: t("detail.tabs.overview"), icon: "FileText" },
        { key: "findings", label: t("detail.tabs.findings"), icon: "Activity", count: findingsCount || undefined },
        { key: "diff", label: t("detail.tabs.diff"), icon: "Code", count: pr.files_count },
      ]}
    />
  );

  return (
    <>
      <div ref={ref} {...{ [FULL_HEADER_ATTR]: "" }} style={small ? { ...s.root, ...s.rootScrolling } : s.root}>
        <div style={s.titleRow}>
          <div style={s.titleCol}>
            <h1 style={s.h1}>
              <span className="mono" style={s.prNumber}>
                #{pr.number}
              </span>
              <span style={s.titleText}>{pr.title}</span>
            </h1>
            <div style={s.meta}>
              <span style={s.authorChip}>
                <Avatar name={pr.author} size={17} />
                {pr.author}
              </span>
              <span style={s.branchChip}>
                <Icon.GitBranch size={13} style={s.mutedIcon} />
                <span className="mono" style={s.branchMono}>
                  {pr.branch}
                </span>
                <Icon.ArrowRight size={11} />
                <span className="mono" style={s.branchMono}>
                  {pr.base}
                </span>
              </span>
              <span className="mono tnum">
                <span style={s.additions}>+{pr.additions}</span>{" "}
                <span style={s.deletions}>−{pr.deletions}</span>
              </span>
              <Badge dot bg="transparent" color={status?.c ?? "var(--text-muted)"}>
                {status ? t(`list.status.${status.labelKey}`) : pr.status}
              </Badge>
            </div>
          </div>
          <div style={s.actions}>
            <Button
              kind="ghost"
              size="sm"
              icon="ExternalLink"
              disabled={!githubUrl}
              onClick={() => githubUrl && window.open(githubUrl, "_blank", "noopener,noreferrer")}
              {...(small ? { "aria-label": githubLabel, title: githubLabel } : null)}
            >
              {small ? <span className="dd-hide-below-md">{githubLabel}</span> : githubLabel}
            </Button>
            {prId && <RunReviewDropdown prId={prId} warnMerged={settled} iconOnlyBelowMd={small} onRunStart={onRunStart} />}
          </div>
        </div>
        {settled && (
          <div style={s.staleBanner}>
            <Icon.AlertTriangle size={13} style={s.warnIcon} />
            <span>{t("detail.settledNotice", { status: pr.status })}</span>
          </div>
        )}
        {small ? <div style={s.tabsScroll}>{tabs}</div> : tabs}
        {small && <div ref={sentinelRef} aria-hidden="true" style={s.sentinel} />}
      </div>
      {small && (
        <CondensedBar
          visible={condensed}
          reducedMotion={reducedMotion}
          number={pr.number}
          title={pr.title}
          titleRef={barTitle}
          onTitleClick={scrollToTop}
          actions={prId && <RunReviewDropdown prId={prId} warnMerged={settled} iconOnlyBelowMd onRunStart={onRunStart} />}
        >
          {tabs}
        </CondensedBar>
      )}
    </>
  );
}
