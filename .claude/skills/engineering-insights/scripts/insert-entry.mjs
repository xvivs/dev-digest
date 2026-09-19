#!/usr/bin/env node
// engineering-insights: deterministic entry insertion into a 7-section INSIGHTS.md.
//
// Usage:
//   node insert-entry.mjs --file <path/to/INSIGHTS.md> --section "<Section Name>" --entry-file <path>
//   node insert-entry.mjs --file <path> --section "Open Questions" --entry-file <path> --warn-at 200
//
// Prints one line of JSON to stdout. Exit codes: 0 = inserted, 2 = exact
// duplicate (file left untouched), 1 = error (bad args, missing file, etc).
//
// This script only does the mechanical part: find the section, self-heal a
// missing heading, insert before the next heading, and count entries. It
// does NOT decide whether something is *worth* writing, and its duplicate
// check is a cheap exact-string backstop, not the semantic near-duplicate
// judgment call — that stays the calling agent's job before it gets here.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CANONICAL_ORDER = [
  "What Works",
  "What Doesn't Work",
  "Codebase Patterns",
  "Tool & Library Notes",
  "Recurring Errors & Fixes",
  "Session Notes",
  "Open Questions",
];

function fail(message) {
  process.stdout.write(JSON.stringify({ status: 'error', message }) + '\n');
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      out[tok.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const filePath = args.file;
const section = args.section;
const entryFilePath = args['entry-file'];
const warnAt = Number(args['warn-at'] ?? 200);

if (!filePath || !section || !entryFilePath) {
  fail('Required: --file <INSIGHTS.md path> --section "<Section Name>" --entry-file <path>');
}
if (!CANONICAL_ORDER.includes(section)) {
  fail(`Unknown section "${section}". Must be exactly one of: ${CANONICAL_ORDER.join(' | ')}`);
}
if (!existsSync(filePath)) fail(`File not found: ${filePath}`);
if (!existsSync(entryFilePath)) fail(`Entry file not found: ${entryFilePath}`);

let raw = readFileSync(filePath, 'utf8');
const entryText = readFileSync(entryFilePath, 'utf8').trim();
if (!entryText) fail('Entry file is empty.');

function findHeadings(text) {
  const lines = text.split('\n');
  const headings = [];
  lines.forEach((line, index) => {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) headings.push({ index, name: m[1] });
  });
  return { lines, headings };
}

let { lines, headings } = findHeadings(raw);
let duplicateHeadingWarning = null;

const presentCanonicalNames = new Set(
  headings.map((h) => h.name).filter((n) => CANONICAL_ORDER.includes(n))
);

if (presentCanonicalNames.size === 0) {
  // None of the 7 canonical headings exist anywhere — recover the full
  // skeleton at EOF rather than dropping the entry silently.
  const stamp = new Date().toISOString().slice(0, 10);
  const skeletonBlock =
    `\n<!-- engineering-insights: recovered missing section structure on ${stamp} -->\n\n` +
    CANONICAL_ORDER.map((s) => `## ${s}\n`).join('\n');
  raw = raw.replace(/\s*$/, '\n') + skeletonBlock;
  ({ lines, headings } = findHeadings(raw));
}

let targetOccurrences = headings.filter((h) => h.name === section);
if (targetOccurrences.length > 1) {
  duplicateHeadingWarning =
    `Section "${section}" appears ${targetOccurrences.length} times; used the first ` +
    'occurrence. Add an Open Questions entry flagging this for cleanup.';
}

if (targetOccurrences.length === 0) {
  // This canonical heading is missing but at least one sibling exists —
  // re-insert it (empty) in its canonical position.
  const myRank = CANONICAL_ORDER.indexOf(section);
  const laterCanonical = headings.find(
    (h) => CANONICAL_ORDER.includes(h.name) && CANONICAL_ORDER.indexOf(h.name) > myRank
  );
  if (laterCanonical) {
    lines.splice(laterCanonical.index, 0, `## ${section}`, '');
  } else {
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push(`## ${section}`, '');
  }
  raw = lines.join('\n');
  ({ lines, headings } = findHeadings(raw));
  targetOccurrences = headings.filter((h) => h.name === section);
}

const headingIndex = targetOccurrences[0].index;
let nextHeadingIndex = -1;
for (let i = headingIndex + 1; i < lines.length; i += 1) {
  if (/^##\s+/.test(lines[i])) {
    nextHeadingIndex = i;
    break;
  }
}
const blockEnd = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;
const blockLines = lines.slice(headingIndex + 1, blockEnd);

// Cheap exact-duplicate backstop (semantic near-duplicate judgment is the
// calling agent's job, done before it ever gets here).
const normalizedEntry = entryText.replace(/\s+/g, ' ').trim();
const isExactDuplicate = blockLines.some(
  (l) => l.trim() && l.replace(/\s+/g, ' ').trim() === normalizedEntry
);
if (isExactDuplicate) {
  process.stdout.write(JSON.stringify({ status: 'duplicate', file: filePath, section }) + '\n');
  process.exit(2);
}

// Rebuild the block with normalized single-blank-line spacing so repeated
// insertions don't accumulate blank lines: heading, blank, [existing content,
// blank], new entry, blank, next heading.
const trimmedBlock = [...blockLines];
while (trimmedBlock.length && trimmedBlock[0].trim() === '') trimmedBlock.shift();
while (trimmedBlock.length && trimmedBlock[trimmedBlock.length - 1].trim() === '') trimmedBlock.pop();
const rebuiltBlock = ['', ...(trimmedBlock.length ? [...trimmedBlock, ''] : []), entryText, ''];

const newLines = [...lines.slice(0, headingIndex + 1), ...rebuiltBlock, ...lines.slice(blockEnd)];
const finalText = newLines.join('\n');
writeFileSync(filePath, finalText);

const totalEntries = (finalText.match(/^- \*\*/gm) || []).length;

process.stdout.write(
  JSON.stringify({
    status: 'inserted',
    file: filePath,
    section,
    totalEntries,
    crossedThreshold: totalEntries >= warnAt && totalEntries - 1 < warnAt,
    duplicateHeadingWarning,
  }) + '\n'
);
