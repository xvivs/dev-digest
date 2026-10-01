import React from "react";

const HIDDEN: React.CSSProperties = {
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

/** Text for assistive tech only (accessible names where the visible UI has no label). */
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span style={HIDDEN}>{children}</span>;
}
