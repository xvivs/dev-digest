/** Where the empty state sends a user with no repositories. */
export const ONBOARDING_HREF = "/onboarding";

/** Skeleton rows shown while the repo list loads. */
export const SKELETON_ROWS: ReadonlyArray<{ height: number; width?: number }> = [
  { height: 20, width: 240 },
  { height: 48 },
  { height: 48 },
];
