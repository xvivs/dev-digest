/** Pure helpers for AppShell. */

import type { RepoSummary } from "@devdigest/ui";
import type { Repo } from "@/lib/types";

/** Whether the poller has synced this repo from GitHub at least once. */
export function isRepoSynced(r: Pick<Repo, "last_polled_at">): boolean {
  return Boolean(r.last_polled_at);
}

/**
 * Map a lib `Repo` to the `RepoSummary` shape the AppFrame shell context
 * expects. The sync label is copy, so the caller supplies it (next-intl);
 * this helper only decides which one applies.
 */
export function toShellRepo(r: Repo, syncedLabel: (synced: boolean) => string): RepoSummary {
  return {
    id: r.id,
    full_name: r.full_name,
    default_branch: r.default_branch,
    syncedLabel: syncedLabel(isRepoSynced(r)),
  };
}

/** Whether an event target is a text-entry element (guards typing-aware shortcuts). */
export function isTextInput(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  return (
    !!node &&
    (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable === true)
  );
}

/** Derive the active sidebar key from the current pathname. */
export function activeKeyFor(pathname: string): string {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.includes("/multi-agent")) return "multi-agent";
  if (pathname.includes("/onboarding")) return "onboarding-tour";
  if (pathname.includes("/context")) return "context";
  if (pathname.includes("/conventions")) return "conventions";
  if (pathname.includes("/pulls")) return "pulls";
  if (pathname.startsWith("/skills")) return "skills";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/eval")) return "eval";
  if (pathname.startsWith("/memory")) return "memory";
  if (pathname.startsWith("/agent-performance")) return "agent-performance";
  if (pathname.startsWith("/ci-runs")) return "ci-runs";
  return "";
}
