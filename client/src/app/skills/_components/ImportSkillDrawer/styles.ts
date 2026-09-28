import type { CSSProperties } from "react";

/** Co-located styles for ImportSkillDrawer. */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  fileInput: {
    width: "100%",
    fontSize: 13.5,
    color: "var(--text-primary)",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  status: { fontSize: 13, color: "var(--text-muted)", marginTop: 12 } satisfies CSSProperties,
  error: {
    fontSize: 12.5,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    padding: "8px 10px",
    borderRadius: 6,
    marginTop: 12,
  } satisfies CSSProperties,
  fieldError: {
    fontSize: 12,
    color: "var(--crit)",
    marginTop: -12,
    marginBottom: 16,
  } satisfies CSSProperties,
  trustBanner: {
    fontSize: 12.5,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "10px 12px",
    borderRadius: 6,
    marginBottom: 20,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  entryList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    border: "1px solid var(--border)",
    borderRadius: 7,
    maxHeight: 200,
    overflow: "auto",
  } satisfies CSSProperties,
  entryRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "7px 10px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  entryName: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  entryTag: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  entryTagRejected: {
    fontSize: 11.5,
    color: "var(--crit)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  changeFileRow: { marginTop: 8 } satisfies CSSProperties,
} as const;
