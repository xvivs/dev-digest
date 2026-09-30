import type { CSSProperties } from "react";
import { PR_HEADER_OFFSET_VAR } from "@/app/repos/[repoId]/pulls/[number]/constants";

/** The sticky row sits on Disclosure's row div (never inside its toggle button)
 *  and below the PR header (zIndex 5); no ancestor up to <main> may set overflow. */
const HEADER_ROW = {
  position: "sticky",
  top: `var(${PR_HEADER_OFFSET_VAR}, 0px)`,
  zIndex: 4,
  background: "var(--bg-primary)",
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "6px 0",
  marginBottom: 8,
} satisfies CSSProperties;

export const s = {
  wrapper: { marginBottom: 18 } satisfies CSSProperties,
  header: HEADER_ROW,
  headerEmpty: { ...HEADER_ROW, opacity: 0.5 } satisfies CSSProperties,
  square: { width: 8, height: 8, borderRadius: 2, flexShrink: 0 } satisfies CSSProperties,
  label: { fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  desc: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  right: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  count: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  findings: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--crit)",
  } satisfies CSSProperties,
  findingsDot: { width: 6, height: 6, borderRadius: 99, background: "var(--crit)" } satisfies CSSProperties,
} as const;

/** Same 90deg chevron as the file cards below the header. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

export function squareFor(color: string): CSSProperties {
  return { ...s.square, background: color };
}
