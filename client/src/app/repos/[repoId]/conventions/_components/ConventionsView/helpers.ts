/* Pure view-model logic for ConventionsView: which of the page's states to
   render (AC-32) and what the extract error means. */
import type { ConventionCandidate, ConventionCategory, ConventionsPage, UpdateConventionBody } from "@devdigest/shared";
import type { ErrorInfo } from "@/lib/types";
import { CONFLICT_STATUS, MAX_SKILL_CONVENTIONS, type TabKey } from "../../constants";
import { INDEXED_STATUSES, NOT_CLONED_CODE, REPO_BLOCKED_CODES } from "./constants";

/**
 * The one state the page renders (AC-32). `allRejected` and `list` share a
 * layout; `failed` keeps any earlier candidates readable underneath its banner.
 */
export type Screen =
  | "loading"
  | "loadError"
  | "scanning"
  | "notIndexed"
  | "never"
  | "failed"
  | "zeroVerified"
  | "allRejected"
  | "list";

export interface ScreenInput {
  page: ConventionsPage | undefined;
  /** The conventions query has no answer yet. */
  loading: boolean;
  loadFailed: boolean;
  /** The repo index is not `full` or `partial`, or an extract said so. */
  indexBlocked: boolean;
  /** The index state is still loading, so `never` vs `notIndexed` is not known yet. */
  indexPending: boolean;
}

export function resolveScreen({ page, loading, loadFailed, indexBlocked, indexPending }: ScreenInput): Screen {
  if (loading) return "loading";
  if (!page) return loadFailed ? "loadError" : "loading";
  if (page.running_scan) return "scanning";
  if (indexBlocked && !page.latest_done_scan) return "notIndexed";
  if (!page.last_scan) return indexPending ? "loading" : "never";
  if (page.last_scan.status === "failed") return "failed";
  if (page.candidates.length === 0) return "zeroVerified";
  if (page.candidates.every((c) => c.status === "rejected")) return "allRejected";
  return "list";
}

/** Whether an index status lets a scan start. Unknown (still loading, or the read failed) does not block. */
export function isIndexBlocked(status: string | undefined): boolean {
  return status !== undefined && !INDEXED_STATUSES.includes(status);
}

/** True for a 409 `repo_not_indexed` / `repo_not_cloned` (AC-3). */
export function isRepoBlockedError(error: ErrorInfo | null): boolean {
  return error?.status === CONFLICT_STATUS && REPO_BLOCKED_CODES.includes(error.code ?? "");
}

/** Which message an empty tab shows: the state-6 message on All, a hint on the others. */
export function emptyTabKind(screen: Screen, tab: TabKey): "allRejected" | "accepted" | "rejected" | null {
  if (tab === "all") return screen === "allRejected" ? "allRejected" : null;
  return tab;
}

/** True when the block is "no clone on disk": a resync cannot fix it, only a re-import can. */
export function isNotCloned({
  clonePath,
  extractError,
  indexReason,
}: {
  clonePath: string | null | undefined;
  extractError: ErrorInfo | null;
  indexReason: string | undefined;
}): boolean {
  return (
    clonePath === null ||
    indexReason === NOT_CLONED_CODE ||
    extractError?.code === NOT_CLONED_CODE
  );
}

/** True once the index can serve a scan (`full` or `partial`). */
export function isIndexed(status: string | undefined): boolean {
  return status !== undefined && INDEXED_STATUSES.includes(status);
}

/** The message to show for a failed request: the server's own text when it answered, else `fallback`. */
export function errorMessage(error: ErrorInfo | null, fallback: string): string | null {
  if (!error) return null;
  return error.status !== undefined ? error.message : fallback;
}

/**
 * The PATCH body for an edit: only the fields that differ from `current`, or `null` when
 * nothing changed (no request is sent). An unknown `current` counts as "everything changed".
 */
export function buildConventionPatch(
  current: Pick<ConventionCandidate, "rule" | "category"> | undefined,
  next: { rule: string; category: ConventionCategory },
): UpdateConventionBody | null {
  const patch: UpdateConventionBody = {
    ...(next.rule !== current?.rule && { rule: next.rule }),
    ...(next.category !== current?.category && { category: next.category }),
  };
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Ids of the accepted candidates in the visible tab. */
export function visibleAcceptedIds(visible: readonly ConventionCandidate[]): string[] {
  return visible.filter((c) => c.status === "accepted").map((c) => c.id);
}

/** True when there is something to select and every one of `ids` is selected. */
export function allSelected(ids: readonly string[], selection: readonly string[]): boolean {
  return ids.length > 0 && ids.every((id) => selection.includes(id));
}

/** A new selection set with `id` added or removed; `prev` is never mutated. */
export function withSelected(prev: ReadonlySet<string>, id: string, on: boolean): Set<string> {
  const next = new Set(prev);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

/** A new selection set with all of `ids` deselected (`deselect`) or selected. */
export function toggleAllSelected(prev: ReadonlySet<string>, ids: readonly string[], deselect: boolean): Set<string> {
  const next = new Set(prev);
  for (const id of ids) {
    if (deselect) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** A skill can be created from 1..MAX_SKILL_CONVENTIONS selected conventions. */
export function canCreateSkill(selectedCount: number): boolean {
  return selectedCount > 0 && selectedCount <= MAX_SKILL_CONVENTIONS;
}

/** Whether the tabbed list renders: it stays readable under a failed-scan banner when older candidates exist. */
export function shouldShowList(screen: Screen, candidateCount: number): boolean {
  return screen === "list" || screen === "allRejected" || (screen === "failed" && candidateCount > 0);
}
