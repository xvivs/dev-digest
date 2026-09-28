/** Pure helpers for the DiffViewer. */
import { HUNK_HEADER_RE, NO_NEWLINE_MARKER } from "./constants";

export interface Line {
  kind: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Parse unified-diff patch text into renderable lines with old/new line numbers. */
export function parsePatch(patch: string | null | undefined): Line[] {
  if (!patch) return [];
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    // "\ No newline at end of file" annotates the line above it; it is not a
    // line of either file, so it must not advance the counters.
    if (raw.startsWith(NO_NEWLINE_MARKER)) continue;
    if (raw.startsWith("@@")) {
      const m = raw.match(HUNK_HEADER_RE);
      if (m) {
        oldNo = parseInt(m[1]!, 10);
        newNo = parseInt(m[2]!, 10);
      }
      out.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newNo });
      newNo++;
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo });
      oldNo++;
    } else {
      out.push({ kind: "ctx", text: raw.slice(raw.startsWith(" ") ? 1 : 0), oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }
  return out;
}

/** Protocols an external link from API data may use; anything else (javascript:, data:) is dropped. */
const SAFE_LINK_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * `url` when it is an absolute http(s) URL, otherwise null. Defence in depth
 * for hrefs taken from proxied API data (GitHub's `html_url`): a forged
 * `javascript:` URI must never reach an `<a href>`.
 */
export function safeExternalHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}
