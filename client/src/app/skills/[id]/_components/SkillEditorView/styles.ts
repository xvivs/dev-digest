import type { CSSProperties } from "react";
import { TOPBAR_HEIGHT } from "@devdigest/ui";

/** Co-located styles for SkillEditorView (the two-pane /skills/:id screen). */
export const s = {
  layout: { display: "flex", height: `calc(100vh - ${TOPBAR_HEIGHT}px)` } satisfies CSSProperties,
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
  dirtyGuardFooter: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  dirtyGuardBody: { padding: 24, fontSize: 14, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
