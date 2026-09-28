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
  pr: PrDetail;
  prId: string | null;
  tab: PrTab;
  findingsCount: number;
  /** github.com PR URL; null when the repo's full_name isn't known yet. */
  githubUrl?: string | null;
  onSetTab: (tab: PrTab) => void;
  /** Fired the moment a review is kicked off (the page switches to the runs tab). */
  onRunStart: () => void;
}

export function PrDetailHeader({ pr, prId, tab, findingsCount, githubUrl, onSetTab, onRunStart }: PrDetailHeaderProps) {
  const t = useTranslations("prReview");
  const status = STATUS_META[pr.status];
  const settled = isSettledPr(pr.status);

  return (
    <div style={s.root}>
      <div style={s.titleRow}>
        <div style={s.titleCol}>
          <h1 style={s.h1}>
            <span className="mono" style={s.prNumber}>
              #{pr.number}
            </span>
            {pr.title}
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
          >
            {t("detail.viewOnGithub")}
          </Button>
          {prId && <RunReviewDropdown prId={prId} warnMerged={settled} onRunStart={onRunStart} />}
        </div>
      </div>
      {settled && (
        <div style={s.staleBanner}>
          <Icon.AlertTriangle size={13} style={s.warnIcon} />
          <span>{t("detail.settledNotice", { status: pr.status })}</span>
        </div>
      )}
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
    </div>
  );
}
