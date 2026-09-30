/* routes.ts — app-internal route helpers shared by more than one feature.
   GitHub deep-links live in github-urls.ts; this file is for our own routes. */
import type { Repo } from "@devdigest/shared";

/** PR list path for a repo — the landing screen of every repo. */
export function repoPullsHref(repoId: Repo["id"]): string {
  return `/repos/${repoId}/pulls`;
}

/** A skill's editor (Config tab). For links from other features, e.g. a convention's "in: skill" badge. */
export function skillHref(skillId: string): string {
  return `/skills/${encodeURIComponent(skillId)}?tab=config`;
}

/** An agent's editor opened on its Skills tab. */
export function agentSkillsHref(agentId: string): string {
  return `/agents/${encodeURIComponent(agentId)}?tab=skills`;
}
