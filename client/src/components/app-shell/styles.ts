import type { CSSProperties } from "react";

/** Screen-reader-only text: keeps the nav dialog's accessible name while the logo is the visible title. */
export const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};
