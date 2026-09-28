/* helpers.ts — pure parsers for skill import (SPEC-02 AC-20/AC-21, ADR 0012
   Untrusted inputs). No React here: everything is a plain function so it can
   be unit-tested without rendering. Two entry points:
     - parseMarkdownSkill  — a picked `.md` file's text
     - parseZipSkill       — a picked `.zip` file, via fflate's streaming Unzip
   `parseImportFile` dispatches between them by extension; it's what the
   drawer component actually calls. */
import type { SkillType } from "@devdigest/shared";
import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import {
  EXECUTABLE_DIR_SEGMENT,
  EXECUTABLE_EXTENSIONS,
  DEFAULT_IMPORT_SKILL_TYPE,
  ZIP_MAX_COMPRESSED_BYTES,
  ZIP_MAX_ENTRIES,
  ZIP_MAX_INFLATED_BYTES,
} from "./constants";

/** One error per SPEC-02 parse-error edge case. The drawer maps `code` to `drawer.errors.<code>`. */
export type ImportParseErrorCode =
  | "tooLarge"
  | "noSkillMd"
  | "bomb"
  | "tooManyEntries"
  | "badUtf8"
  | "nulByte"
  | "unsupported"
  | "readFailed";

export class ImportParseError extends Error {
  code: ImportParseErrorCode;
  constructor(code: ImportParseErrorCode, message: string) {
    super(message);
    this.name = "ImportParseError";
    this.code = code;
  }
}

/** A skill draft derived from an imported file, before the user edits it in the preview step. */
export interface ParsedSkillDraft {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  /** Whether `name` came from frontmatter/SKILL.md rather than being slugified from the file name. */
  nameFromFrontmatter: boolean;
}

/** One non-SKILL.md archive entry, listed in the preview (SPEC-02 AC-21). Never read for content. */
export interface ZipEntryInfo {
  name: string;
  /** A `..` segment or a leading `/` — never read, listed as rejected. */
  rejected: boolean;
  /** Under `scripts/`, or an executable extension — never run, listed as skipped. */
  executable: boolean;
}

export interface ParsedImportResult {
  skill: ParsedSkillDraft;
  /** Every other archive entry (the chosen SKILL.md is excluded). Empty for a `.md` import. */
  entries: ZipEntryInfo[];
}

const SKILL_TYPES: ReadonlySet<string> = new Set(["rubric", "convention", "security", "custom"]);
function isSkillType(v: string | undefined): v is SkillType {
  return v != null && SKILL_TYPES.has(v);
}

/** Turns a file name into a slug-shaped name when there is no frontmatter `name:` (SPEC-02 AC-20). */
export function slugifyFileName(fileName: string): string {
  const base = fileName.replace(/\.[^./]+$/, "");
  const slug = base
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "imported-skill";
}

/**
 * A tiny, safe `---`-delimited frontmatter parser: single-line `key: value`
 * pairs only — no nesting, no lists, no multi-line scalars, no YAML library,
 * no eval. Returns `null` when there is no closed `---` block, so the whole
 * file is treated as body text.
 */
function parseFrontmatter(raw: string): { attrs: Record<string, string>; body: string } | null {
  const lines = raw.split(/\r?\n/);
  if ((lines[0] ?? "").trim() !== "---") return null;

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  const attrs: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.length >= 2) {
      const first = value.charAt(0);
      const last = value.charAt(value.length - 1);
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    if (key) attrs[key] = value;
  }

  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return { attrs, body };
}

/** `.md` import (SPEC-02 AC-20): frontmatter `name`/`description`/`type` + body, or a bare body. */
export function parseMarkdownSkill(fileName: string, text: string): ParsedSkillDraft {
  const fm = parseFrontmatter(text);
  if (!fm) {
    return {
      name: slugifyFileName(fileName),
      description: "",
      type: DEFAULT_IMPORT_SKILL_TYPE,
      body: text,
      nameFromFrontmatter: false,
    };
  }
  const name = fm.attrs.name?.trim();
  return {
    name: name || slugifyFileName(fileName),
    description: fm.attrs.description?.trim() ?? "",
    type: isSkillType(fm.attrs.type) ? fm.attrs.type : DEFAULT_IMPORT_SKILL_TYPE,
    body: fm.body,
    nameFromFrontmatter: Boolean(name),
  };
}

/** Rejected per SPEC-02 Edge cases: a `..` path segment, or an absolute path. */
export function isRejectedZipPath(name: string): boolean {
  if (name.startsWith("/") || name.startsWith("\\")) return true;
  return name.split(/[/\\]/).some((seg) => seg === "..");
}

/** Flagged per SPEC-02 AC-21: under `scripts/`, or an executable extension (fflate exposes no unix exec bit). */
export function isExecutableZipPath(name: string): boolean {
  const lower = name.toLowerCase();
  const segments = lower.split("/");
  if (segments.slice(0, -1).includes(EXECUTABLE_DIR_SEGMENT)) return true;
  return EXECUTABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

type SkillMdTarget = "SKILL.md" | "skill.md";

/** 0 = archive root, 1 = exactly one directory deep, `null` = not a match at all. Case-sensitive. */
function skillMdDepth(name: string, target: SkillMdTarget): 0 | 1 | null {
  const parts = name.split("/").filter((p) => p.length > 0 && p !== ".");
  if (parts.length === 0) return null;
  if (parts[parts.length - 1] !== target) return null;
  if (parts.length === 1) return 0;
  if (parts.length === 2) return 1;
  return null;
}

function decodeStrictUtf8(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportParseError("badUtf8", "File is not valid UTF-8 text.");
  }
  if (text.includes("\u0000")) throw new ImportParseError("nulByte", "File contains a NUL byte.");
  return text;
}

/**
 * Reads a File's raw bytes. Prefers the native `Blob.arrayBuffer()`; falls
 * back to `FileReader` when it is missing (this repo's vitest+jsdom
 * environment ships a `File`/`Blob` without `arrayBuffer()` — real browsers
 * have supported it for years). Both paths return the file's actual bytes.
 */
function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsArrayBuffer(file);
  });
}

/** Reads a `.md` File's raw bytes and decodes them under the same hygiene as an archived SKILL.md. */
async function readMarkdownFile(file: File): Promise<string> {
  let buf: ArrayBuffer;
  try {
    buf = await readFileBytes(file);
  } catch {
    throw new ImportParseError("readFailed", "Could not read this file.");
  }
  return decodeStrictUtf8(new Uint8Array(buf));
}

/**
 * `.zip` import (SPEC-02 AC-21, Edge cases). Streams the archive through
 * fflate's `Unzip`/`UnzipInflate`, tallying REAL inflated bytes as they come
 * out of the decompressor — never the header's `originalSize`, which a zip
 * bomb can lie about (or which a legitimately-built archive of highly
 * compressible data makes irrelevant either way, since only the observed
 * byte count ever drives the abort). Locates `SKILL.md` (falling back to
 * `skill.md`) at the root or exactly one directory deep; every other entry
 * is reported by name only — never read for content — and flagged
 * rejected/executable so the drawer can list it as "skipped, not executed".
 */
export async function parseZipSkill(file: File): Promise<ParsedImportResult> {
  if (file.size > ZIP_MAX_COMPRESSED_BYTES) {
    throw new ImportParseError("tooLarge", "Archive is larger than 1 MB.");
  }

  let buf: ArrayBuffer;
  try {
    buf = await readFileBytes(file);
  } catch {
    throw new ImportParseError("readFailed", "Could not read this file.");
  }

  const entries: ZipEntryInfo[] = [];
  const candidates: { target: SkillMdTarget; depth: 0 | 1; name: string; chunks: Uint8Array[] }[] = [];
  let totalInflated = 0;
  let entryCount = 0;
  let aborted: ImportParseError | null = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (entry) => {
    if (aborted) return;
    entryCount += 1;
    if (entryCount > ZIP_MAX_ENTRIES) {
      aborted = new ImportParseError("tooManyEntries", "Archive has more than 200 entries.");
      throw aborted; // stop push() now instead of walking the rest of the archive
    }

    const name = entry.name;
    const rejected = isRejectedZipPath(name);
    const executable = isExecutableZipPath(name);
    entries.push({ name, rejected, executable });

    let matchedTarget: SkillMdTarget | null = null;
    let matchedDepth: 0 | 1 | null = null;
    if (!rejected) {
      const upper = skillMdDepth(name, "SKILL.md");
      if (upper !== null) {
        matchedTarget = "SKILL.md";
        matchedDepth = upper;
      } else {
        const lower = skillMdDepth(name, "skill.md");
        if (lower !== null) {
          matchedTarget = "skill.md";
          matchedDepth = lower;
        }
      }
    }

    const chunks: Uint8Array[] = [];
    if (matchedTarget !== null && matchedDepth !== null) {
      candidates.push({ target: matchedTarget, depth: matchedDepth, name, chunks });
    }

    entry.ondata = (err, data) => {
      if (aborted) return;
      if (err) {
        aborted = new ImportParseError("readFailed", "Could not decompress archive.");
        throw aborted;
      }
      totalInflated += data.length;
      if (totalInflated > ZIP_MAX_INFLATED_BYTES) {
        aborted = new ImportParseError("bomb", "Archive expands past 5 MB once decompressed.");
        // Throwing out of the callback unwinds fflate's synchronous push(), so a
        // bomb stops inflating at the limit instead of freezing the tab.
        throw aborted;
      }
      if (matchedTarget !== null) chunks.push(data);
    };
    entry.start();
  };

  try {
    unzip.push(new Uint8Array(buf), true);
  } catch {
    if (!aborted) aborted = new ImportParseError("readFailed", "Could not read this archive.");
  }
  if (aborted) throw aborted;

  candidates.sort((a, b) => (a.target !== b.target ? (a.target === "SKILL.md" ? -1 : 1) : a.depth - b.depth));
  const chosen = candidates[0];
  if (!chosen) {
    throw new ImportParseError("noSkillMd", "No SKILL.md found at the archive root or one level deep.");
  }

  let total = 0;
  for (const c of chosen.chunks) total += c.length;
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const c of chosen.chunks) {
    combined.set(c, offset);
    offset += c.length;
  }

  const text = decodeStrictUtf8(combined);
  const skill = parseMarkdownSkill(chosen.name.split("/").pop() ?? chosen.target, text);
  const otherEntries = entries.filter((e) => e.name !== chosen.name);

  return { skill, entries: otherEntries };
}

/** Dispatches on extension. The drawer's only entry point into parsing. */
export async function parseImportFile(file: File): Promise<ParsedImportResult> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".zip")) return parseZipSkill(file);
  if (lower.endsWith(".md")) {
    const text = await readMarkdownFile(file);
    return { skill: parseMarkdownSkill(file.name, text), entries: [] };
  }
  throw new ImportParseError("unsupported", "Choose a .md or .zip file.");
}
