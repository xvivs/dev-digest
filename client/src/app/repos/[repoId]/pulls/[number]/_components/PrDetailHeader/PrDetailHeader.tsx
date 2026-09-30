"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, Button, Tabs } from "@devdigest/ui";
import type { PrDetail } from "@/lib/types";
import { STATUS_META } from "@/app/repos/[repoId]/pulls/constants";
import type { PrTab } from "@/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/constants";
import { RunReviewDropdown } from "../RunReviewDropdown";
import { isSettledPr } from "./helpers";
import { s } from "./styles";

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
  /** Below the md breakpoint: dense layout, icon-only actions. */
  mobile?: boolean;
  /** Mobile only: scrolled past the collapse threshold, show the one-row header. */
  compact?: boolean;
  /** prefers-reduced-motion: reduce (smooth scroll becomes instant). */
  reducedMotion?: boolean;
}

/** Marks regions that hide in compact state, so focus inside one can be rescued. */
const COLLAPSIBLE_ATTR = "data-pr-header-collapsible";

/** Animated show/hide. `inert` keeps the hidden content out of the tab order and the a11y tree. */
function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div {...{ [COLLAPSIBLE_ATTR]: "" }} inert={!open} style={{ ...s.collapsible, ...(open ? null : s.collapsibleClosed) }}>
      <div style={s.collapsibleInner}>{children}</div>
    </div>
  );
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
  compact = false,
  reducedMotion = false,
}: PrDetailHeaderProps) {
  const t = useTranslations("prReview");
  const status = STATUS_META[pr.status];
  const settled = isSettledPr(pr.status);
  const isCompact = mobile && compact;
  const titleButton = React.useRef<HTMLButtonElement>(null);

  // Collapsing hides regions; if focus was inside one, hand it to the compact
  // title instead of dropping it on <body>. Layout effect: it must read
  // activeElement before the browser's next style pass blurs the hidden node.
  React.useLayoutEffect(() => {
    if (!isCompact) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(`[${COLLAPSIBLE_ATTR}]`)) titleButton.current?.focus();
  }, [isCompact]);

  const scrollToTop = (e: React.MouseEvent<HTMLElement>) =>
    e.currentTarget.closest("main")?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });

  const meta = (
    <div style={mobile ? { ...s.meta, ...s.metaMobile } : s.meta}>
      <span style={s.authorChip}>
        <Avatar name={pr.author} size={17} />
        {pr.author}
      </span>
      <span style={s.branchChip}>
        <Icon.GitBranch size={13} style={s.mutedIcon} />
        <span className="mono" style={mobile ? { ...s.branchMono, ...s.branchMonoMobile } : s.branchMono}>
          {pr.branch}
        </span>
        <Icon.ArrowRight size={11} />
        <span className="mono" style={mobile ? { ...s.branchMono, ...s.branchMonoMobile } : s.branchMono}>
          {pr.base}
        </span>
      </span>
      <span className="mono tnum">
        <span style={s.additions}>+{pr.additions}</span> <span style={s.deletions}>−{pr.deletions}</span>
      </span>
      <Badge dot bg="transparent" color={status?.c ?? "var(--text-muted)"}>
        {status ? t(`list.status.${status.labelKey}`) : pr.status}
      </Badge>
    </div>
  );

  const settledNotice = (
    <div style={s.staleBanner}>
      <Icon.AlertTriangle size={13} style={s.warnIcon} />
      <span>{t("detail.settledNotice", { status: pr.status })}</span>
    </div>
  );

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

  const githubButton = (
    <Button
      kind="ghost"
      size="sm"
      icon="ExternalLink"
      disabled={!githubUrl}
      onClick={() => githubUrl && window.open(githubUrl, "_blank", "noopener,noreferrer")}
      {...(mobile ? { "aria-label": t("detail.viewOnGithub"), title: t("detail.viewOnGithub") } : null)}
    >
      {mobile ? undefined : t("detail.viewOnGithub")}
    </Button>
  );

  return (
    <div
      ref={ref}
      data-compact={isCompact ? "true" : "false"}
      style={{ ...s.root, ...(mobile ? s.rootMobile : null), ...(isCompact ? s.rootCompact : null) }}
    >
      <div style={{ ...s.titleRow, ...(mobile ? s.titleRowMobile : null), ...(isCompact ? s.titleRowCompact : null) }}>
        <div style={s.titleCol}>
          <h1 style={{ ...s.h1, ...(mobile ? s.h1Mobile : null), ...(isCompact ? s.h1Compact : null) }}>
            {isCompact ? (
              <button ref={titleButton} type="button" title={pr.title} onClick={scrollToTop} style={s.compactTitleButton}>
                <span className="mono" style={{ ...s.prNumber, ...s.prNumberMobile }}>
                  #{pr.number}
                </span>
                <span style={s.titleOneLine}>{pr.title}</span>
              </button>
            ) : (
              <>
                <span className="mono" style={mobile ? { ...s.prNumber, ...s.prNumberMobile } : s.prNumber}>
                  #{pr.number}
                </span>
                {mobile ? <span style={s.titleClamp}>{pr.title}</span> : pr.title}
              </>
            )}
          </h1>
          {mobile ? <Collapsible open={!isCompact}>{meta}</Collapsible> : meta}
        </div>
        <div style={mobile ? { ...s.actions, ...s.actionsMobile } : s.actions}>
          {mobile ? (
            // Plain `hidden` (not inert): the span has no inline display, so the UA rule applies.
            <span hidden={isCompact} {...{ [COLLAPSIBLE_ATTR]: "" }}>
              {githubButton}
            </span>
          ) : (
            githubButton
          )}
          {prId && <RunReviewDropdown prId={prId} warnMerged={settled} iconOnly={mobile} onRunStart={onRunStart} />}
        </div>
      </div>
      {settled && (mobile ? <Collapsible open={!isCompact}>{settledNotice}</Collapsible> : settledNotice)}
      {mobile ? <div style={s.tabsScroll}>{tabs}</div> : tabs}
    </div>
  );
}
