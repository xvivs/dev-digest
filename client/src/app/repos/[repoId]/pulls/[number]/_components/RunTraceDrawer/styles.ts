import type { CSSProperties } from "react";

/** Co-located styles for RunTraceDrawer (extracted from inline styles). */
export const s = {
  // ---- TraceSection ----
  section: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 14,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  /** Disclosure header row (the toggle button inherits `gap`). */
  sectionHead: {
    gap: 10,
    padding: "12px 16px",
  } satisfies CSSProperties,
  sectionIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  sectionTitle: { fontSize: 14, fontWeight: 600, flex: 1 } satisfies CSSProperties,
  sectionBody: { borderTop: "1px solid var(--border)", padding: 16 } satisfies CSSProperties,

  // ---- ToolCallRow ----
  toolRow: {
    borderRadius: 6,
    border: "1px solid var(--border)",
    marginBottom: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  toolHead: {
    gap: 10,
    padding: "10px 12px",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  toolIcon: { color: "var(--warn)" } satisfies CSSProperties,
  toolName: { fontSize: 13 } satisfies CSSProperties,
  toolArgs: { color: "var(--text-muted)" } satisfies CSSProperties,
  toolMeta: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  toolMs: { fontSize: 12, color: "var(--text-secondary)", width: 50, textAlign: "right" } satisfies CSSProperties,
  toolDetail: {
    padding: "10px 14px",
    fontSize: 12,
    color: "var(--text-secondary)",
    background: "var(--code-bg)",
    borderTop: "1px solid var(--border)",
    lineHeight: 1.5,
  } satisfies CSSProperties,

  // ---- PromptBlock ----
  promptRow: {
    borderRadius: 6,
    border: "1px solid var(--border)",
    marginBottom: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  promptHead: { gap: 10, padding: "8px 12px" } satisfies CSSProperties,
  promptDot: (color: string): CSSProperties => ({ width: 7, height: 7, borderRadius: 2, background: color }),
  promptLabel: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  promptToggle: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  promptActions: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  miniBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-muted)",
    cursor: "pointer",
  } satisfies CSSProperties,

  // ---- PromptModalBody ----
  modalBody: { display: "flex", flexDirection: "column", height: "70vh" } satisfies CSSProperties,
  modalSearch: { padding: "12px 24px", borderBottom: "1px solid var(--border)", flexShrink: 0 } satisfies CSSProperties,
  modalMatchCount: { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  modalScroll: { flex: 1, minHeight: 0, overflow: "auto" } satisfies CSSProperties,
  modalNoMatches: {
    padding: "32px 24px",
    textAlign: "center",
    color: "var(--text-muted)",
    fontSize: 13,
  } satisfies CSSProperties,
  modalPre: { margin: 0, padding: "16px 24px", whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.6 } satisfies CSSProperties,
  modalMark: { background: "var(--accent)", color: "var(--bg-primary)", borderRadius: 2 } satisfies CSSProperties,

  // ---- FindingsSection ----
  findingList: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  finding: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  findingHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 } satisfies CSSProperties,
  findingTitle: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  findingLocation: { fontSize: 11.5, color: "var(--text-muted)", marginBottom: 6 } satisfies CSSProperties,
  findingText: { fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  findingSuggestion: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginTop: 6,
  } satisfies CSSProperties,
  promptPre: {
    margin: 0,
    padding: "12px 14px",
    fontSize: 12,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    background: "var(--code-bg)",
    borderTop: "1px solid var(--border)",
    whiteSpace: "pre-wrap",
    maxHeight: 180,
    overflow: "auto",
  } satisfies CSSProperties,

  // ---- Stat ----
  stat: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 7,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  statLabel: { fontSize: 12, color: "var(--text-muted)", fontWeight: 600 } satisfies CSSProperties,
  statVal: { fontSize: 16, fontWeight: 700, marginTop: 4 } satisfies CSSProperties,

  // ---- TraceBody ----
  configList: { display: "flex", flexDirection: "column", gap: 10, fontSize: 13 } satisfies CSSProperties,
  configModel: { color: "var(--accent-text)" } satisfies CSSProperties,
  configProvider: { color: "var(--text-secondary)" } satisfies CSSProperties,
  specsWrap: { display: "flex", gap: 6, flexWrap: "wrap" } satisfies CSSProperties,
  specsNone: { color: "var(--text-muted)" } satisfies CSSProperties,
  spec: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  statsRow: { display: "flex", gap: 10 } satisfies CSSProperties,
  rawPre: {
    margin: 0,
    padding: "12px 14px",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-primary)",
    background: "var(--code-bg)",
    borderRadius: 6,
    whiteSpace: "pre-wrap",
    overflow: "auto",
    maxHeight: 220,
  } satisfies CSSProperties,

  // ---- Row ----
  row: { display: "flex", gap: 12 } satisfies CSSProperties,
  rowLabel: { color: "var(--text-muted)", width: 110 } satisfies CSSProperties,

  // ---- Drawer body ----
  footer: { display: "flex", gap: 10 } satisfies CSSProperties,
  tabBody: { paddingTop: 18 } satisfies CSSProperties,
  emptyNote: { fontSize: 13, color: "var(--text-muted)", padding: 16 } satisfies CSSProperties,
  noToolCalls: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
