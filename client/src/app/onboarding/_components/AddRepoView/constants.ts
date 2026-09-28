/** Literals for the add-repository screen. */

/** Where Cancel / Esc / the close button return to. */
export const CLOSE_HREF = "/";

/** The settings section that holds the provider keys, linked from the lede. */
export const API_KEYS_HREF = "/settings/api-keys";

/** Where a freshly added repository lands. */
export function repoPullsHref(repoId: string): string {
  return `/repos/${repoId}/pulls`;
}
