/** The two Preview tab modes (SPEC-02 AC-10). */
export const PREVIEW_MODES = ["rendered", "source"] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];

export const DEFAULT_PREVIEW_MODE: PreviewMode = "rendered";
