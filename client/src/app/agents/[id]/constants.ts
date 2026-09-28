import type { IconName } from "@devdigest/ui";
import { DEFAULT_EDITOR_TAB } from "../constants";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Editor tabs — shared by AgentEditor (renders them) and AgentEditorView (validates `?tab=`).
 * SPEC-02 adds Skills; later lessons add Evals/Stats/CI.
 */
export const EDITOR_TABS: readonly EditorTab[] = [
  { key: DEFAULT_EDITOR_TAB, labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
];
