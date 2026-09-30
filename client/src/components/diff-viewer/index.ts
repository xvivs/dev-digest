/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export type { DiffFindingApi, DiffFindingCardProps } from "./findings";
export { isActiveFinding, findingsForFile } from "./findings";
export { UnmatchedFindings } from "./UnmatchedFindings";
