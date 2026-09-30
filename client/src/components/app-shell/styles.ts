import type { CSSProperties } from "react";
import { TOPBAR_HEIGHT } from "@devdigest/ui";

/** Drawer header keeps the Topbar's height so the layered logo trigger sits over it, not over content. */
export const DRAWER_TOP_INSET = TOPBAR_HEIGHT;

/** "Home" row at the top of the drawer body: on mobile nothing else links to "/". */
export const homeRow: CSSProperties = {
  display: "block",
  padding: "10px 14px",
  margin: "0 0 5px",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  color: "var(--text-secondary)",
};
