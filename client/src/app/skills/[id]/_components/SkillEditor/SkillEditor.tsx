/* SkillEditor — tab bar + the active tab's body (SPEC-02 D3). Tab switches
   route through the dirty-form navigation guard (AC-8); the skill's own
   editing state (ConfigTab's draft) is not lifted here — that tab reports its
   dirty flag through the guard instead (see ../../../navigation-guard). */
"use client";

import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Skill, SkillStatsWindow } from "@devdigest/shared";
import { useNavigationGuard } from "@/app/skills/navigation-guard";
import { SKILL_EDITOR_TABS } from "../../constants";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { EvalsTab } from "./_components/EvalsTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { s } from "./styles";

export function SkillEditor({
  skill,
  tab,
  onTab,
  fromVersion = null,
  onEditVersion,
  onDraftSaved,
  statsWindow = "30d",
  onStatsWindow,
  runRequested = false,
  onRunRequestHandled,
  evalCaseId = null,
  evalSuiteId = null,
  onOpenEvalCase,
  onCloseEvalCase,
  onSelectEvalSuite,
}: {
  skill: Skill;
  tab: string;
  onTab: (t: string) => void;
  /** Config opens this snapshot as an unsaved draft (restore "Edit", ADR 0016). */
  fromVersion?: number | null;
  /** Versions → "Edit": switch to Config seeded from vN. */
  onEditVersion?: (version: number) => void;
  /** Config saved the draft that came from `fromVersion`. */
  onDraftSaved?: () => void;
  /** Stats tab window, from `?window=` (skill-impact decision 11). */
  statsWindow?: SkillStatsWindow;
  onStatsWindow?: (w: SkillStatsWindow) => void;
  /** Header "Run on evals" was pressed: the Evals tab opens its Run modal. */
  runRequested?: boolean;
  onRunRequestHandled?: () => void;
  /** Evals tab case drawer, from `?case=` / `?suite=`. */
  evalCaseId?: string | null;
  evalSuiteId?: string | null;
  onOpenEvalCase?: (caseId: string) => void;
  onCloseEvalCase?: () => void;
  onSelectEvalSuite?: (suiteId: string) => void;
}) {
  const t = useTranslations("skills");
  const guard = useNavigationGuard();
  const tabs = SKILL_EDITOR_TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));

  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={(k) => guard.confirmNavigation(() => onTab(k))} pad="0 24px" />
      </div>
      <div style={s.body}>
        {tab === "config" && <ConfigTab skill={skill} fromVersion={fromVersion} onDraftSaved={onDraftSaved} />}
        {tab === "preview" && <PreviewTab body={skill.body} />}
        {tab === "evals" && (
          <EvalsTab
            skill={skill}
            runRequested={runRequested}
            onRunRequestHandled={onRunRequestHandled}
            caseId={evalCaseId}
            caseSuiteId={evalSuiteId}
            onOpenCase={onOpenEvalCase}
            onCloseCase={onCloseEvalCase}
            onSelectCaseSuite={onSelectEvalSuite}
            // The Evals tab holds no draft of its own; the guard still covers a dirty Config.
            onOpenConfig={() => guard.confirmNavigation(() => onTab("config"))}
          />
        )}
        {tab === "stats" && (
          <StatsTab
            skill={skill}
            window={statsWindow}
            onWindowChange={(w) => onStatsWindow?.(w)}
            onRunEvals={() => guard.confirmNavigation(() => onTab("evals"))}
          />
        )}
        {tab === "versions" && (
          <VersionsTab
            skill={skill}
            // Versions holds no draft, but route through the guard anyway so
            // this stays correct if that ever changes.
            onEditVersion={(v) => guard.confirmNavigation(() => onEditVersion?.(v))}
          />
        )}
      </div>
    </div>
  );
}
