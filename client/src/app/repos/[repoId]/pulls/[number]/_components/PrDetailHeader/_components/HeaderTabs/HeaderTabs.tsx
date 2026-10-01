/* HeaderTabs — the PR tab strip. Two tablists can exist (full header + condensed
   bar); distinct `ariaLabel`s tell them apart. */
"use client";

import React from "react";
import { Tabs } from "@devdigest/ui";
import type { PrTab } from "@/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/constants";

export interface HeaderTabsProps {
  ariaLabel: string;
  tab: PrTab;
  onSetTab: (tab: PrTab) => void;
  tabs: React.ComponentProps<typeof Tabs>["tabs"];
}

export function HeaderTabs({ ariaLabel, tab, onSetTab, tabs }: HeaderTabsProps) {
  return (
    <Tabs
      value={tab}
      // Tabs is a generic string-keyed primitive; the keys are always one of
      // PR_TABS, so the cast back to PrTab is safe.
      onChange={(k) => onSetTab(k as PrTab)}
      pad="0"
      ariaLabel={ariaLabel}
      tabs={tabs}
    />
  );
}
