import type { SkillType } from "@devdigest/shared";

/** File picker `accept` attribute (SPEC-02 AC-20/AC-21). */
export const IMPORT_ACCEPT = ".md,.zip";

/** A `.zip` must be this size or smaller before it is even read (SPEC-02 Edge cases). */
export const ZIP_MAX_COMPRESSED_BYTES = 1 * 1024 * 1024;
/**
 * Real (streamed, not header-declared) inflated bytes across the WHOLE
 * archive before the parser aborts — a zip bomb lies about `originalSize` in
 * its central directory, so the abort decision only ever looks at bytes that
 * actually came out of the decompressor (SPEC-02 Edge cases: "Zip whose
 * declared sizes lie").
 */
export const ZIP_MAX_INFLATED_BYTES = 5 * 1024 * 1024;
/** Archives with more entries than this are rejected outright. */
export const ZIP_MAX_ENTRIES = 200;

/** A path under this directory is flagged executable regardless of extension. */
export const EXECUTABLE_DIR_SEGMENT = "scripts";
/** Extensions flagged executable regardless of directory — fflate exposes no unix exec bit. */
export const EXECUTABLE_EXTENSIONS = [
  ".sh",
  ".bash",
  ".zsh",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".py",
  ".rb",
  ".ps1",
  ".bat",
  ".cmd",
  ".exe",
] as const;

/** Skill type used when a `.md` has no frontmatter, or an unrecognized `type:` value. */
export const DEFAULT_IMPORT_SKILL_TYPE: SkillType = "custom";

export const DRAWER_WIDTH = 640;
