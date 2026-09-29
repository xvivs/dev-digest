import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView. */
export const s = {
  page: { maxWidth: 1040, margin: "0 auto", padding: "28px 32px 56px" } satisfies CSSProperties,
  section: { marginTop: 22 } satisfies CSSProperties,
  errorBox: {
    marginTop: 18,
    padding: "12px 14px",
    borderRadius: 8,
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 14,
  } satisfies CSSProperties,
  inlineError: { marginTop: 10, color: "var(--crit)", fontSize: 13 } satisfies CSSProperties,
  errorTitle: { fontWeight: 700 } satisfies CSSProperties,
  failedBox: {
    marginTop: 18,
    padding: "14px 16px",
    borderRadius: 10,
    border: "1px solid var(--border-strong)",
    background: "var(--crit-bg)",
    display: "flex",
    alignItems: "center",
    gap: 16,
  } satisfies CSSProperties,
  failedText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  failedTitle: { fontSize: 15, fontWeight: 700, color: "var(--crit)" } satisfies CSSProperties,
  failedBody: { fontSize: 13.5, color: "var(--text-secondary)", marginTop: 4, overflowWrap: "anywhere" } satisfies CSSProperties,
  details: { marginTop: 6, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  detailsRaw: { display: "block", marginTop: 4, whiteSpace: "pre-wrap", overflowWrap: "anywhere" } satisfies CSSProperties,
  toolbar: { display: "flex", alignItems: "center", gap: 12, margin: "16px 0" } satisfies CSSProperties,
  selectedCount: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  cards: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  emptyTab: { padding: "36px 0", textAlign: "center", fontSize: 14, color: "var(--text-muted)" } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 14, marginTop: 22 } satisfies CSSProperties,
} as const;
