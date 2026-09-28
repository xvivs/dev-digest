import type { CSSProperties } from "react";

/** Co-located styles for SkillCard. */
export const s = {
  card: (active: boolean, enabled: boolean, linked: boolean): CSSProperties => ({
    padding: 14,
    borderRadius: 8,
    cursor: linked ? "pointer" : "default",
    border: "1px solid " + (active ? "var(--border-strong)" : "var(--border)"),
    background: active ? "var(--bg-hover)" : "var(--bg-elevated)",
    opacity: enabled ? 1 : 0.6,
    marginBottom: 10,
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  name: {
    fontSize: 14,
    fontWeight: 600,
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  /** The skill name when the card navigates: same look as `name`, but a link. */
  nameLink: {
    fontSize: 14,
    fontWeight: 600,
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: "inherit",
    textDecoration: "none",
  } satisfies CSSProperties,
  description: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "8px 0",
    lineHeight: 1.4,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  metaRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 } satisfies CSSProperties,
  sourceLabel: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
