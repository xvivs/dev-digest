/* routes.ts — app-internal route helpers shared by more than one feature.
   GitHub deep-links live in github-urls.ts; this file is for our own routes. */
import type { Repo } from "@devdigest/shared";

/** PR list path for a repo — the landing screen of every repo. */
export function repoPullsHref(repoId: Repo["id"]): string {
  return `/repos/${repoId}/pulls`;
}
