import type { CSSProperties } from "react";

/** Max content width of the PR detail body (matches the header's layout). */
const CONTENT_MAX_WIDTH = 1080;

export const s = {
  skeleton: {
    padding: "28px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: CONTENT_MAX_WIDTH,
    margin: "0 auto",
  } satisfies CSSProperties,
  body: {
    padding: "24px 32px 44px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: CONTENT_MAX_WIDTH,
    margin: "0 auto",
  } satisfies CSSProperties,
} as const;
