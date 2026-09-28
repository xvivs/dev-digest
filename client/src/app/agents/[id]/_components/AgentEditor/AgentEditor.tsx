/* AgentEditor — renders the tab named by `tab`. Config and Skills ship now;
   later lessons add Evals/Stats/CI. Tab state lives in ?tab= (AgentEditorView). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { EDITOR_TABS } from "../../constants";
import { ConfigTab } from "./_components/ConfigTab";
import { SkillsTab } from "./_components/SkillsTab";
import { s } from "./styles";

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = EDITOR_TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {/* key: a different agent gets a fresh tab instance, so its draft (or,
            for Skills, its pending-save refs) is seeded from that agent instead
            of carrying the previous agent's state over — see ConfigTab and
            SkillsTab's own docs for why each needs this. */}
        {tab === "skills" ? (
          <SkillsTab key={agent.id} agent={agent} />
        ) : (
          <ConfigTab key={agent.id} agent={agent} />
        )}
      </div>
    </div>
  );
}
