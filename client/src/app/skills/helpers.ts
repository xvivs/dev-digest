import { DEFAULT_EDITOR_TAB, SKILLS_HREF } from "./constants";

/** URL of a skill's editor, opened on `tab`. */
export function skillEditorHref(id: string, tab: string = DEFAULT_EDITOR_TAB): string {
  return `${SKILLS_HREF}/${encodeURIComponent(id)}?tab=${encodeURIComponent(tab)}`;
}

/**
 * Invisible/bidi characters the Preview tab's Source view and the Review &
 * trust dialog both mark (spec edge case: "Body contains U+E0000–E007F, bidi
 * overrides or zero-width chars" — the server rejects these with 422; the UI
 * shows them so a person can see why before they ever hit save).
 * Ranges: zero-width space/ZWNJ/ZWJ, BOM, bidi embedding/override controls,
 * bidi isolates, and Unicode tag characters (used for invisible prompt smuggling).
 */
// Mirrors server/src/modules/skills/constants.ts INVISIBLE_CHARS_PATTERN — keep in sync.
const INVISIBLE_CHAR_SOURCE =
  "[\\u200B-\\u200F\\u2060-\\u2064\\u061C\\u180E\\u00AD\\uFEFF\\u202A-\\u202E\\u2066-\\u2069\\u{E0000}-\\u{E007F}]";

/** One printable run, or one flagged invisible character with its code point label. */
export interface SourceSegment {
  text: string;
  /** Set only for a single invisible/bidi character, e.g. "U+200B". */
  invisibleLabel?: string;
}

function codePointLabel(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Splits a skill body into printable runs and flagged invisible characters, in order. */
export function splitInvisibleChars(body: string): SourceSegment[] {
  const segments: SourceSegment[] = [];
  const re = new RegExp(INVISIBLE_CHAR_SOURCE, "gu");
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    if (match.index > lastIndex) segments.push({ text: body.slice(lastIndex, match.index) });
    segments.push({ text: match[0], invisibleLabel: codePointLabel(match[0]) });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length || segments.length === 0) segments.push({ text: body.slice(lastIndex) });
  return segments;
}

/** Whether a body carries any of the flagged invisible/bidi characters. */
export function hasInvisibleChars(body: string): boolean {
  return new RegExp(INVISIBLE_CHAR_SOURCE, "u").test(body);
}

/** Rendered markdown hides HTML comments; the Source view warns when one is present. */
export function hasHtmlComment(body: string): boolean {
  return body.includes("<!--");
}

// ---- Skill-impact formatting, shared by the Stats and Evals tabs ----

/** `passing / total` as a whole percent for CircularScore; 0 when there are no cases. */
export function passRatePercent(passing: number, total: number): number {
  return total > 0 ? Math.round((passing / total) * 100) : 0;
}

/** Signed one-decimal delta: "+0.4", "−1.2" (U+2212), "0.0". */
export function formatSignedDelta(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const abs = Math.abs(rounded).toFixed(1);
  if (rounded > 0) return `+${abs}`;
  if (rounded < 0) return `−${abs}`;
  return abs;
}
