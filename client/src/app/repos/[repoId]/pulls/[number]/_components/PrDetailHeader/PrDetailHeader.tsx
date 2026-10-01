"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, Button, usePrefersReducedMotion } from "@devdigest/ui";
import type { PrDetail } from "@/lib/types";
import { STATUS_META } from "@/app/repos/[repoId]/pulls/constants";
import type { PrTab } from "@/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/constants";
import { RunReviewDropdown } from "../RunReviewDropdown";
import { CondensedBar } from "./_components/CondensedBar";
import { HeaderTabs } from "./_components/HeaderTabs";
import { useCondensedHeader } from "./hooks";
import { isSettledPr } from "./helpers";
import { rootFor, s } from "./styles";

export interface PrDetailHeaderProps {
  /** Root element ref (React 19 ref-as-prop); PrDetailContent measures it for sticky offsets. */
  ref?: React.Ref<HTMLDivElement>;
  pr: PrDetail;
  prId: string | null;
  tab: PrTab;
  findingsCount: number;
  /** github.com PR URL; null when the repo's full_name isn't known yet. */
  githubUrl?: string | null;
  onSetTab: (tab: PrTab) => void;
  /** Fired the moment a review is kicked off (the page switches to the runs tab). */
  onRunStart: () => void;
  /** Below md: the header scrolls with the content and a pinned bar takes over once it is gone. */
  mobile?: boolean;
}

export function PrDetailHeader({
  ref,
  pr,
  prId,
  tab,
  findingsCount,
  githubUrl,
  onSetTab,
  onRunStart,
  mobile = false,
}: PrDetailHeaderProps) {
  const t = useTranslations("prReview");
  const status = STATUS_META[pr.status];
  const settled = isSettledPr(pr.status);
  const reducedMotion = usePrefersReducedMotion();
  // Condensed state lives HERE, not in PrDetailContent: a toggle must re-render
  // only this subtree, not the diff below.
  const { layout, setSentinel } = useCondensedHeader(mobile);
  const small = layout !== "desktop";
  const condensed = layout === "condensed";
  const titleHeading = React.useRef<HTMLHeadingElement>(null);
  const bar = React.useRef<HTMLDivElement>(null);

  // The bar goes inert when the header scrolls back in. If focus is in it (e.g.
  // after tapping its title), move it to the heading first: otherwise it drops
  // to <body>, and the browser warns about aria-hidden over a focused element.
  // Layout effect: before the browser's focus fix-up. preventScroll: no jump.
  React.useLayoutEffect(() => {
    if (condensed) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && bar.current?.contains(active)) titleHeading.current?.focus({ preventScroll: true });
  }, [condensed]);

  const scrollToTop = (e: React.MouseEvent<HTMLElement>) =>
    e.currentTarget.closest("main")?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });

  const githubLabel = t("detail.viewOnGithub");
  const tabDefs = [
    { key: "overview", label: t("detail.tabs.overview"), icon: "FileText" },
    { key: "findings", label: t("detail.tabs.findings"), icon: "Activity", count: findingsCount || undefined },
    { key: "diff", label: t("detail.tabs.diff"), icon: "Code", count: pr.files_count },
  ] as const;
  const tabsList = [...tabDefs];
  const tabs = <HeaderTabs ariaLabel={t("detail.tabs.label")} tab={tab} onSetTab={onSetTab} tabs={tabsList} />;

  return (
    <>
      <div ref={ref} style={rootFor(small)}>
        <div style={s.titleRow}>
          <div style={s.titleCol}>
            <h1 ref={titleHeading} tabIndex={-1} style={s.h1}>
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
        {small && <div ref={setSentinel} aria-hidden="true" style={s.sentinel} />}
      </div>
      {small && (
        <CondensedBar
          visible={condensed}
          reducedMotion={reducedMotion}
          number={pr.number}
          title={pr.title}
          ref={bar}
          onTitleClick={scrollToTop}
          actions={prId && <RunReviewDropdown prId={prId} warnMerged={settled} iconOnlyBelowMd onRunStart={onRunStart} />}
        >
          <HeaderTabs ariaLabel={t("detail.tabs.labelCondensed")} tab={tab} onSetTab={onSetTab} tabs={tabsList} />
        </CondensedBar>
      )}
    </>
  );
}
