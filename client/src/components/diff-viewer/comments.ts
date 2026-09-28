/* Inline-comment support for the DiffViewer (Files changed tab).
   Pure domain helpers (thread grouping, line matching) + the API shape the
   viewer needs. No React here: the components are CommentThreadView,
   CommentCard, InlineComposer and OutdatedComments, and their styles live in
   styles.ts. Comments are GitHub PR review comments, proxied live. */
import type { PrReviewComment } from "@/lib/types";
import type { Line } from "./helpers";

/** What the viewer needs to read + write inline comments. */
export interface DiffCommentApi {
  comments: PrReviewComment[];
  canComment: boolean;
  /** When false, existing comment threads are hidden (the "+" still works). */
  showComments: boolean;
  posting: boolean;
  onSubmit: (input: {
    path: string;
    line: number;
    side: "LEFT" | "RIGHT";
    body: string;
    in_reply_to?: number;
  }) => Promise<unknown>;
}

/** One review-comment thread anchored to a diff line (or outdated). */
export interface CommentThread {
  rootId: number;
  comments: PrReviewComment[];
  line: number | null;
  side: "LEFT" | "RIGHT";
  isOutdated: boolean;
}

/** `${side}:${line}` — the key a thread/line is matched on. */
export function lineKey(side: "LEFT" | "RIGHT", line: number | null | undefined): string | null {
  return line == null ? null : `${side}:${line}`;
}

/** Group flat comments into threads (root + replies), ordered oldest-first. */
export function buildThreads(comments: PrReviewComment[]): CommentThread[] {
  const byRoot = new Map<number, PrReviewComment[]>();
  for (const c of comments) {
    const rootId = c.in_reply_to_id ?? c.id;
    const list = byRoot.get(rootId) ?? [];
    list.push(c);
    byRoot.set(rootId, list);
  }
  const threads: CommentThread[] = [];
  for (const [rootId, list] of byRoot) {
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const root = sorted.find((c) => c.id === rootId) ?? sorted[0]!;
    threads.push({
      rootId,
      comments: sorted,
      line: root.line,
      side: root.side,
      isOutdated: root.line == null,
    });
  }
  return threads;
}

/** Keys a parsed line can host a thread on (RIGHT=new line, LEFT=old line). */
export function keysForLine(ln: Line): string[] {
  const keys: string[] = [];
  if (ln.kind === "add" || ln.kind === "ctx") {
    const k = lineKey("RIGHT", ln.newNo);
    if (k) keys.push(k);
  }
  if (ln.kind === "del" || ln.kind === "ctx") {
    const k = lineKey("LEFT", ln.oldNo);
    if (k) keys.push(k);
  }
  return keys;
}

/** The (line, side) a "+" on this row should comment on, or null if none. */
export function commentTargetFor(ln: Line): { line: number; side: "LEFT" | "RIGHT" } | null {
  if ((ln.kind === "add" || ln.kind === "ctx") && ln.newNo != null)
    return { line: ln.newNo, side: "RIGHT" };
  if (ln.kind === "del" && ln.oldNo != null) return { line: ln.oldNo, side: "LEFT" };
  return null;
}

/**
 * Split threads into those that match a rendered line (keyed) and "outdated"
 * ones GitHub can no longer anchor (or whose line isn't in this patch). The
 * outdated bucket is surfaced separately so nothing is silently dropped.
 */
export function partitionThreads(
  threads: CommentThread[],
  renderedKeys: Set<string>,
): { matched: Map<string, CommentThread[]>; outdated: CommentThread[] } {
  const matched = new Map<string, CommentThread[]>();
  const outdated: CommentThread[] = [];
  for (const th of threads) {
    const key = th.line != null ? `${th.side}:${th.line}` : null;
    if (key && renderedKeys.has(key)) {
      const list = matched.get(key) ?? [];
      list.push(th);
      matched.set(key, list);
    } else {
      outdated.push(th);
    }
  }
  return { matched, outdated };
}
