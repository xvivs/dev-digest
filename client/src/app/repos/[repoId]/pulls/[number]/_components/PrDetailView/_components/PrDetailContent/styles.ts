import type { CSSProperties } from "react";
import {
  HEADER_COLLAPSE_AT,
  HEADER_EXPAND_AT,
  PR_HEADER_FULL_OFFSET_VAR,
  PR_HEADER_OFFSET_VAR,
} from "@/app/repos/[repoId]/pulls/[number]/constants";
import { s as viewStyles } from "../../styles";

/** Zero-size marker pinned to a scroll offset inside <main> (its containing
 *  block); the collapse observer watches it cross the top edge. */
function sentinel(top: number): CSSProperties {
  return { position: "absolute", top, left: 0, width: 1, height: 1, pointerEvents: "none" };
}

export const s = {
  collapseSentinel: sentinel(HEADER_COLLAPSE_AT) satisfies CSSProperties,
  expandSentinel: sentinel(HEADER_EXPAND_AT) satisfies CSSProperties,
  /** Mobile body: reserves what the collapsed header gave up, so the flow above
   *  the content keeps its height. Both vars live on this element. */
  bodyUnderHeader: {
    ...viewStyles.body,
    margin: `max(0px, calc(var(${PR_HEADER_FULL_OFFSET_VAR}, 0px) - var(${PR_HEADER_OFFSET_VAR}, 0px))) auto 0`,
  } satisfies CSSProperties,
} as const;
