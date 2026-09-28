/* findings-popover — hover/focus preview of a PR's findings, plus the pure
   geometry it is placed with. Public surface of the folder. */
export { FindingsPopover } from "./FindingsPopover";
export { clampToViewport, sortBySeverity, lineLabel } from "./helpers";
export type { PanelPosition, Placement } from "./helpers";
export { OPEN_DELAY, CLOSE_DELAY, PREVIEW_LIMIT, PANEL_GAP } from "./constants";
