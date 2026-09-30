/** Visible diff markers. The minus is U+2212 so it lines up with "+" in a mono font. */
export const DIFF_SIGN = { add: "+", del: "−", ctx: " " } as const;

/** Width of the Field column in the metadata table. The longest label ("description", 11 chars in mono) plus 3ch for cell padding. */
export const FIELD_COL_WIDTH = "14ch";
