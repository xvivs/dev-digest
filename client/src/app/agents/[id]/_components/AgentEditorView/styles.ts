import type { CSSProperties } from "react";
import { TOPBAR_HEIGHT } from "@devdigest/ui";
import { LIST_PANE_WIDTH } from "./constants";

/** Co-located styles for AgentEditorView (the two-pane /agents/:id screen). */
export const s = {
  layout: { display: "flex", height: `calc(100vh - ${TOPBAR_HEIGHT}px)` } satisfies CSSProperties,
  listPane: {
    width: LIST_PANE_WIDTH,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  listHeader: { padding: "16px 16px 12px" } satisfies CSSProperties,
  listTitleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 } satisfies CSSProperties,
  listTitle: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  listBody: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,
  loading: { flex: 1, padding: 28, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  editor: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } satisfies CSSProperties,
  editorHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 28px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  editorIcon: { color: "var(--accent)" } satisfies CSSProperties,
  editorTitle: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  editorActions: { marginLeft: "auto" } satisfies CSSProperties,
  editorBody: { flex: 1, minHeight: 0, overflow: "auto" } satisfies CSSProperties,
} as const;
