/* RunReviewDropdown — ported from components2.jsx.
   "Run all enabled agents" / a specific agent → kicks off POST /pulls/:id/review
   and hands the resulting runIds up so the parent can stream SSE live status. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, type DropdownItemDef } from "@devdigest/ui";
import { useAgents, usePrActiveRuns, useRunReview } from "@/lib/hooks";
import { AGENTS_HREF, DROPDOWN_WIDTH } from "./constants";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  iconOnlyBelowMd = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Hide the text label below md (dd-hide-below-md) and expose it as aria-label/title instead. */
  iconOnlyBelowMd?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const run = useRunReview();
  // Server-sourced, shared by every dropdown on the screen (header + condensed
  // bar): one run in flight blocks a duplicate start from either.
  const { data: activeRuns } = usePrActiveRuns(prId);
  const busy = run.isPending || (activeRuns?.length ?? 0) > 0;
  const all = agents ?? [];
  const hasEnabled = all.some((a) => a.enabled);

  const triggerLabel = busy ? t("runReview.running") : t("runReview.runReview");

  const kick = async (opts: { all?: boolean; agentId?: string }) => {
    if (busy) return;
    onRunStart?.();
    try {
      const res = await run.mutateAsync({ prId, ...opts });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
    } finally {
      onRunSettled?.();
    }
  };

  // List EVERY agent (not just enabled) so they're always visible; a specific
  // agent can be run regardless of its enabled flag. "Run all" still targets
  // only enabled agents.
  const agentItems: DropdownItemDef[] = all.length
    ? all.map((a) => ({
        label: a.name,
        icon: "Cpu" as const,
        hint: a.enabled ? a.model : t("runReview.disabledHint", { model: a.model }),
        onClick: () => kick({ agentId: a.id }),
      }))
    : [{ label: t("runReview.noAgents"), icon: "Plus", muted: true, onClick: () => router.push(AGENTS_HREF) }];

  const items: DropdownItemDef[] = [
    // Merged/closed PRs can still be reviewed (informational only); lead with a
    // muted, non-actionable warning so the intent is clear.
    ...(warnMerged
      ? [
          { label: t("runReview.mergedWarning"), icon: "AlertTriangle" as const, muted: true },
          { divider: true } as DropdownItemDef,
        ]
      : []),
    {
      label: t("runReview.runAll"),
      icon: "Play",
      ...(hasEnabled ? {} : { muted: true }),
      onClick: () => kick({ all: true }),
    },
    { divider: true },
    ...agentItems,
    { divider: true },
    { label: t("runReview.configureAgents"), icon: "Settings", muted: true, onClick: () => router.push(AGENTS_HREF) },
  ];

  return (
    <Dropdown
      width={DROPDOWN_WIDTH}
      align="right"
      items={items}
      trigger={
        <span
          title={warnMerged ? t("runReview.mergedTooltip") : undefined}
          style={warnMerged ? s.dimmedTrigger : undefined}
        >
          <Button
            kind={kind}
            size={size}
            iconRight="ChevronDown"
            icon="Sparkles"
            loading={busy}
            {...(iconOnlyBelowMd ? { "aria-label": triggerLabel, title: warnMerged ? undefined : triggerLabel } : null)}
          >
            {iconOnlyBelowMd ? <span className="dd-hide-below-md">{triggerLabel}</span> : triggerLabel}
          </Button>
        </span>
      }
    />
  );
}
