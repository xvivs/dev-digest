/** Clamps a review score into the 0..100 range the UI renders. */
export function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}
