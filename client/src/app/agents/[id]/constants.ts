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
 * Part-0 ships Config only; later lessons add the rest.
 */
export const EDITOR_TABS: readonly EditorTab[] = [
  { key: DEFAULT_EDITOR_TAB, labelKey: "editor.tabs.config", icon: "Settings" },
];
