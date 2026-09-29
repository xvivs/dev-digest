import type { CSSProperties } from "react";

/** Co-located styles for ConfigTab. */
export const s = {
  wrap: { maxWidth: 720 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", marginBottom: 20 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  enabledLabel: { display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  bodyMeta: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  tokenCount: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  bodyFrame: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  bodyFileHeader: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 12, marginTop: 24 } satisfies CSSProperties,
  savedNote: { fontSize: 13, color: "var(--ok, var(--accent))" } satisfies CSSProperties,
  deleteBtn: { marginLeft: "auto" } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  confirmBody: { padding: 24, fontSize: 14, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
