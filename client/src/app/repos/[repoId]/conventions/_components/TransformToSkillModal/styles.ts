import type { CSSProperties } from "react";

/** Co-located styles for TransformToSkillModal. */
export const s = {
  body: { padding: "20px 24px", display: "flex", flexDirection: "column" } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    marginBottom: 20,
    borderRadius: 8,
    background: "var(--accent-bg)",
    color: "var(--text-secondary)",
    fontSize: 14,
  } satisfies CSSProperties,
  bannerStrong: { color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
  bannerRepo: { color: "var(--accent-text)" } satisfies CSSProperties,
  twoCols: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20 } satisfies CSSProperties,
  fieldError: { fontSize: 12.5, color: "var(--crit)", marginTop: 6 } satisfies CSSProperties,
  errorBox: {
    padding: "10px 12px",
    marginBottom: 16,
    borderRadius: 8,
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 13,
  } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footerNote: { flex: 1, fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  confirmBody: { padding: 24, fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55 } satisfies CSSProperties,
  confirmFooter: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
