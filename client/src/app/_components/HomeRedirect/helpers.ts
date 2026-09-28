import type { Repo } from "@devdigest/shared";

/** Which of the three home states to show. */
export type HomeView =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "redirect"; repo: Repo; href: string };

/** PR list path for a repo — the landing screen of every repo. */
export function repoPullsHref(repoId: Repo["id"]): string {
  return `/repos/${repoId}/pulls`;
}

/** Picks the home state. An errored or empty list both fall back to "empty". */
export function homeView(input: {
  repos: Repo[] | undefined;
  isLoading: boolean;
  isError: boolean;
}): HomeView {
  if (input.isLoading) return { kind: "loading" };
  const first = input.isError ? undefined : input.repos?.[0];
  if (!first) return { kind: "empty" };
  return { kind: "redirect", repo: first, href: repoPullsHref(first.id) };
}
