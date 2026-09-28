import type { CSSProperties } from "react";

/** Co-located styles for ReviewRunAccordion. */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    marginBottom: 14,
    overflow: "hidden",
    scrollMarginTop: 16,
  } satisfies CSSProperties,
  /** Header row: the Disclosure toggle button plus the trailing trash action. */
  header: {
    gap: 12,
    padding: "13px 16px",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  cpuIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  agentName: { fontWeight: 600, fontSize: 14 } satisfies CSSProperties,
  counts: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  when: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  body: { padding: "0 16px 16px" } satisfies CSSProperties,
  bannerWrap: { marginBottom: 16 } satisfies CSSProperties,
} as const;
