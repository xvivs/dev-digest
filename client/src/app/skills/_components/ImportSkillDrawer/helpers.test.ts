import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { zipSync } from "fflate";
import {
  ImportParseError,
  isExecutableZipPath,
  isRejectedZipPath,
  parseImportFile,
  parseMarkdownSkill,
  parseZipSkill,
  slugifyFileName,
} from "./helpers";

const enc = (text: string) => new TextEncoder().encode(text);

function mdFile(name: string, text: string): File {
  return new File([text], name, { type: "text/markdown" });
}

function zipFile(name: string, entries: Record<string, Uint8Array>): File {
  const bytes = zipSync(entries);
  return new File([bytes], name, { type: "application/zip" });
}

const SKILL_MD_TEXT = [
  "---",
  "name: branch-coverage-gate",
  "description: Use when a branch is untested. Flags missing cases.",
  "type: rubric",
  "---",
  "",
  "# Branch coverage",
  "",
  "Flag untested branches.",
].join("\n");

describe("slugifyFileName", () => {
  it("lowercases, strips the extension and non-alphanumerics, and collapses runs of them into one dash", () => {
    expect(slugifyFileName("PR Quality Rubric.md")).toBe("pr-quality-rubric");
    expect(slugifyFileName("api_contract--v2.zip")).toBe("api-contract-v2");
  });

  it("falls back to a placeholder for a name with no alphanumeric characters", () => {
    expect(slugifyFileName("!!!.md")).toBe("imported-skill");
  });
});

describe("parseMarkdownSkill", () => {
  it("reads name/description/type from frontmatter and leaves the rest as body", () => {
    const draft = parseMarkdownSkill("whatever.md", SKILL_MD_TEXT);
    expect(draft).toEqual({
      name: "branch-coverage-gate",
      description: "Use when a branch is untested. Flags missing cases.",
      type: "rubric",
      body: "# Branch coverage\n\nFlag untested branches.",
      nameFromFrontmatter: true,
    });
  });

  it("without frontmatter, slugifies the file name and leaves description empty (AC-20)", () => {
    const draft = parseMarkdownSkill("PR Quality Rubric.md", "# Just a body\nNo frontmatter here.");
    expect(draft).toEqual({
      name: "pr-quality-rubric",
      description: "",
      type: "custom",
      body: "# Just a body\nNo frontmatter here.",
      nameFromFrontmatter: false,
    });
  });

  it("falls back to the slugified file name when frontmatter omits `name`, and defaults an unknown `type`", () => {
    const text = ["---", "description: Only a description.", "type: not-a-real-type", "---", "Body."].join("\n");
    const draft = parseMarkdownSkill("my-skill.md", text);
    expect(draft.name).toBe("my-skill");
    expect(draft.nameFromFrontmatter).toBe(false);
    expect(draft.type).toBe("custom");
    expect(draft.body).toBe("Body.");
  });

  it("treats an unclosed `---` block as no frontmatter at all", () => {
    const text = "---\nname: nope\nno closing delimiter";
    const draft = parseMarkdownSkill("unclosed.md", text);
    expect(draft.nameFromFrontmatter).toBe(false);
    expect(draft.body).toBe(text);
  });
});

describe("isRejectedZipPath / isExecutableZipPath", () => {
  it("rejects a `..` segment anywhere in the path, and a leading absolute slash", () => {
    expect(isRejectedZipPath("../evil.txt")).toBe(true);
    expect(isRejectedZipPath("pkg/../../evil.txt")).toBe(true);
    expect(isRejectedZipPath("/etc/passwd")).toBe(true);
    expect(isRejectedZipPath("SKILL.md")).toBe(false);
    expect(isRejectedZipPath("pkg/SKILL.md")).toBe(false);
  });

  it("flags a scripts/ path or an executable extension, case-insensitively", () => {
    expect(isExecutableZipPath("scripts/check.sh")).toBe(true);
    expect(isExecutableZipPath("a/b/scripts/setup.py")).toBe(true);
    expect(isExecutableZipPath("Setup.EXE")).toBe(true);
    expect(isExecutableZipPath("README.txt")).toBe(false);
    expect(isExecutableZipPath("SKILL.md")).toBe(false);
  });
});

describe("parseZipSkill", () => {
  it("finds SKILL.md at the archive root", async () => {
    const file = zipFile("skill.zip", { "SKILL.md": enc(SKILL_MD_TEXT), "README.txt": enc("filler") });
    const result = await parseZipSkill(file);
    expect(result.skill.name).toBe("branch-coverage-gate");
    expect(result.skill.body).toBe("# Branch coverage\n\nFlag untested branches.");
    expect(result.entries).toEqual([{ name: "README.txt", rejected: false, executable: false }]);
  });

  it("finds SKILL.md exactly one directory deep", async () => {
    const file = zipFile("skill.zip", { "my-skill/SKILL.md": enc(SKILL_MD_TEXT) });
    const result = await parseZipSkill(file);
    expect(result.skill.name).toBe("branch-coverage-gate");
  });

  it("does not match SKILL.md two directories deep", async () => {
    const file = zipFile("skill.zip", { "a/b/SKILL.md": enc(SKILL_MD_TEXT) });
    await expect(parseZipSkill(file)).rejects.toMatchObject({ code: "noSkillMd" });
  });

  it("falls back to lowercase skill.md when SKILL.md is absent", async () => {
    const file = zipFile("skill.zip", { "skill.md": enc(SKILL_MD_TEXT) });
    const result = await parseZipSkill(file);
    expect(result.skill.name).toBe("branch-coverage-gate");
  });

  it("rejects a zip with no SKILL.md anywhere", async () => {
    const file = zipFile("skill.zip", { "README.txt": enc("nothing here") });
    await expect(parseZipSkill(file)).rejects.toMatchObject({ code: "noSkillMd" });
  });

  it("lists a `../evil` entry as rejected, never as a SKILL.md candidate", async () => {
    const file = zipFile("skill.zip", {
      "SKILL.md": enc(SKILL_MD_TEXT),
      "../evil.txt": enc("payload"),
    });
    const result = await parseZipSkill(file);
    expect(result.skill.name).toBe("branch-coverage-gate");
    expect(result.entries).toEqual([{ name: "../evil.txt", rejected: true, executable: false }]);
  });

  it("flags scripts/check.sh as executable and lists it — its content is never read into the skill", async () => {
    const file = zipFile("skill.zip", {
      "SKILL.md": enc(SKILL_MD_TEXT),
      "scripts/check.sh": enc("#!/bin/sh\ntouch /tmp/marker"),
    });
    const result = await parseZipSkill(file);
    expect(result.entries).toEqual([{ name: "scripts/check.sh", rejected: false, executable: true }]);
    expect(result.skill.body).not.toContain("touch");
  });

  it("aborts a zip bomb by real decompressed bytes, ignoring any declared size (a 6 MB compressible buffer)", async () => {
    const bomb = new Uint8Array(6 * 1024 * 1024); // all zeros: deflates to a tiny compressed size
    const file = zipFile("bomb.zip", { "SKILL.md": enc(SKILL_MD_TEXT), "big.bin": bomb });
    expect(file.size).toBeLessThan(1024 * 1024);
    await expect(parseZipSkill(file)).rejects.toMatchObject({ code: "bomb" });
  });

  it("rejects an archive with more than 200 entries", async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 201; i++) entries[`file-${i}.txt`] = enc("x");
    const file = zipFile("many.zip", entries);
    await expect(parseZipSkill(file)).rejects.toMatchObject({ code: "tooManyEntries" });
  });

  it("rejects a SKILL.md with a NUL byte", async () => {
    const withNul = new Uint8Array([...enc("# Title\n"), 0x00, ...enc("rest")]);
    const file = zipFile("skill.zip", { "SKILL.md": withNul });
    await expect(parseZipSkill(file)).rejects.toMatchObject({ code: "nulByte" });
  });

  it("rejects a SKILL.md that is not valid UTF-8", async () => {
    const invalid = new Uint8Array([0xff, 0xfe, 0x00, 0x01]);
    const file = zipFile("skill.zip", { "SKILL.md": invalid });
    await expect(parseZipSkill(file)).rejects.toMatchObject({ code: "badUtf8" });
  });

  it("rejects an archive larger than 1 MB before it is even read", async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024)], "huge.zip", { type: "application/zip" });
    await expect(parseZipSkill(big)).rejects.toMatchObject({ code: "tooLarge" });
  });
});

describe("parseImportFile", () => {
  it("parses a .md file by extension", async () => {
    const file = mdFile("my-rubric.md", SKILL_MD_TEXT);
    const result = await parseImportFile(file);
    expect(result.skill.name).toBe("branch-coverage-gate");
    expect(result.entries).toEqual([]);
  });

  it("rejects a NUL byte in a picked .md file", async () => {
    const withNul = new Uint8Array([...enc("# Title\n"), 0x00]);
    const file = new File([withNul], "bad.md", { type: "text/markdown" });
    await expect(parseImportFile(file)).rejects.toMatchObject({ code: "nulByte" });
  });

  it("rejects an unsupported extension", async () => {
    const file = new File(["whatever"], "notes.txt", { type: "text/plain" });
    await expect(parseImportFile(file)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("parses the real api-breaking-change fixture: SKILL.md found, scripts/check.sh flagged and never executed", async () => {
    const bytes = readFileSync(resolve(__dirname, "../../../../../../fixtures/skills/api-breaking-change.zip"));
    const file = new File([bytes], "api-breaking-change.zip", { type: "application/zip" });
    const result = await parseImportFile(file);

    expect(result.skill.name).toBe("api-breaking-change");
    expect(result.skill.type).toBe("rubric");
    expect(result.skill.description).toContain("Use when a PR changes an HTTP route");
    expect(result.skill.body).toContain("# API Breaking Change");
    expect(result.skill.body).not.toContain("touch"); // scripts/check.sh's content never entered the skill body

    // The fixture was built with `zip -r api-breaking-change.zip api-breaking-change`
    // (fixtures/skills/README.md), so every entry carries that folder prefix.
    const scriptEntry = result.entries.find((e) => e.name === "api-breaking-change/scripts/check.sh");
    expect(scriptEntry).toEqual({ name: "api-breaking-change/scripts/check.sh", rejected: false, executable: true });
    const readme = result.entries.find((e) => e.name === "api-breaking-change/README.txt");
    expect(readme).toEqual({ name: "api-breaking-change/README.txt", rejected: false, executable: false });
  });
});

describe("ImportParseError", () => {
  it("carries its error code as a typed property", () => {
    const err = new ImportParseError("bomb", "too big");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("bomb");
  });
});
