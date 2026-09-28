import type { IconName } from "@devdigest/ui";
import { DEFAULT_EDITOR_TAB } from "../constants";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface SkillEditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Skill editor tabs (SPEC-02 D3): Evals still renders as a placeholder. */
export const SKILL_EDITOR_TABS: readonly SkillEditorTab[] = [
  { key: DEFAULT_EDITOR_TAB, labelKey: "detail.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "detail.tabs.preview", icon: "Eye" },
  { key: "evals", labelKey: "detail.tabs.evals", icon: "FlaskConical" },
  { key: "stats", labelKey: "detail.tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "detail.tabs.versions", icon: "History" },
];
