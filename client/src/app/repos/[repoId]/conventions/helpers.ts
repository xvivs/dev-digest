/* Pure logic for the Conventions route, shared by its sibling components
   (view, card, modal). No React, no API calls — every rule here is unit-tested. */
import type {
  AgentSkillLink,
  ConventionCandidate,
  ConventionEvidence,
  SkillListItem,
} from "@devdigest/shared";
import {
  AGENT_SKILLS_BUDGET_BYTES,
  CONFIDENCE_HIGH_PCT,
  CONFIDENCE_MEDIUM_PCT,
  HEADING_SLUG_MAX_LENGTH,
  MIN_FENCE_LENGTH,
  RULE_MAX_LENGTH,
  RULE_MIN_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  SKILL_NAME_PATTERN,
  SKILL_NAME_SUFFIX,
  SNIPPET_MAX_LINES,
  type ConfidenceTone,
  type TabKey,
} from "./constants";

// ---- tabs ----

/** All = pending + accepted; Accepted; Rejected (D8). */
export function filterByTab(candidates: readonly ConventionCandidate[], tab: TabKey): ConventionCandidate[] {
  if (tab === "all") return candidates.filter((c) => c.status !== "rejected");
  return candidates.filter((c) => c.status === tab);
}

/** The count on each tab, tallied from the one candidates array so the tabs and the list never disagree. */
export function tabCounts(candidates: readonly ConventionCandidate[]): Record<TabKey, number> {
  return {
    all: filterByTab(candidates, "all").length,
    accepted: filterByTab(candidates, "accepted").length,
    rejected: filterByTab(candidates, "rejected").length,
  };
}

// ---- confidence ----

/** Whole-percent label of a 0..1 confidence. */
export function confidencePct(confidence: number): number {
  return Math.round(confidence * 100);
}

/** Tone from the rounded percentage, so "80%" is never painted amber (D16). */
export function confidenceTone(confidence: number): ConfidenceTone {
  const pct = confidencePct(confidence);
  if (pct >= CONFIDENCE_HIGH_PCT) return "high";
  if (pct >= CONFIDENCE_MEDIUM_PCT) return "medium";
  return "low";
}

// ---- selection (AC-39) ----

/** Ids of the accepted candidates, in list order. */
export function acceptedIds(candidates: readonly ConventionCandidate[]): string[] {
  return candidates.filter((c) => c.status === "accepted").map((c) => c.id);
}

/**
 * The selection that counts is the stored selection intersected with what is
 * accepted right now: rejecting a selected card, or a rescan that drops it,
 * silently removes it instead of leaving a phantom id in the payload.
 */
export function effectiveSelection(selected: ReadonlySet<string>, accepted: readonly string[]): string[] {
  return accepted.filter((id) => selected.has(id));
}

// ---- rule editing (AC-37) ----

/** Whether an edited rule satisfies the server's bounds (8..300 after trimming). */
export function isRuleValid(rule: string): boolean {
  const n = rule.trim().length;
  return n >= RULE_MIN_LENGTH && n <= RULE_MAX_LENGTH;
}

// ---- skill name (D16, V12) ----

/** `text` as a skill-name slug: lowercase ASCII words joined by single hyphens, at most 64 chars. Empty when nothing survives. */
export function slugifySkillName(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_NAME_MAX_LENGTH)
    .replace(/-+$/, "");
}

/** Whether `name` satisfies the server's skill-name rule. */
export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_PATTERN.test(name);
}

/** `<repo-slug>-conventions`, always a valid skill name even for an odd or very long repo name. */
export function defaultSkillName(repoName: string): string {
  const base = slugifySkillName(repoName)
    .slice(0, SKILL_NAME_MAX_LENGTH - SKILL_NAME_SUFFIX.length)
    .replace(/-+$/, "");
  return base ? `${base}${SKILL_NAME_SUFFIX}` : SKILL_NAME_SUFFIX.slice(1);
}

// ---- skill body (AC-43, G11) ----

/** The Markdown fence for `text`: longer than the longest backtick run in it, so a snippet cannot close it early. */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(MIN_FENCE_LENGTH, longest + 1));
}

/** The first `SNIPPET_MAX_LINES` lines of a snippet, without trailing blank lines. */
export function clipSnippet(snippet: string): { text: string; lines: number; truncated: boolean } {
  const all = snippet.replace(/\s+$/, "").split("\n");
  const lines = all.slice(0, SNIPPET_MAX_LINES);
  return { text: lines.join("\n"), lines: lines.length, truncated: all.length > SNIPPET_MAX_LINES };
}

/** A slug cut to `max` characters at a word boundary when it can be (never mid-word for a multi-word slug). */
function truncateSlug(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  if (slug[max] === "-") return cut;
  const lastHyphen = cut.lastIndexOf("-");
  return lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut;
}

/** A heading-safe slug of the rule (never raw rule text: a rule cannot inject Markdown structure). */
export function ruleHeading(rule: string): string {
  return truncateSlug(slugifySkillName(rule), HEADING_SLUG_MAX_LENGTH).replace(/-+$/, "") || "rule";
}

function evidenceBlock(ev: ConventionEvidence): string {
  const { text, lines, truncated } = clipSnippet(ev.snippet);
  // A clipped snippet must not cite lines it no longer shows.
  const end = truncated ? Math.min(ev.line_end, ev.line_start + lines - 1) : ev.line_end;
  const path = ev.path.replace(/`/g, "'");
  const fence = fenceFor(text);
  return `Detected in \`${path}:${ev.line_start}-${end}\`:\n\n${fence}\n${text}\n${fence}`;
}

export interface SkillBodyInput {
  /** Short repo name, e.g. `payments-api`. */
  repoName: string;
  /** The skill's name — becomes the H1. */
  skillName: string;
  conventions: readonly Pick<ConventionCandidate, "rule" | "evidence">[];
}

/**
 * The starting body of a skill made from accepted conventions. Pure and
 * deterministic; the server re-validates whatever the user saves (D16).
 * It opens with a reviewer preamble (G11) telling the model to cite
 * violations as `file:line` and to ignore a rule the diff does not touch.
 * Each rule is a section: heading, the rule, then its evidence with the real
 * snippet fenced beyond any backtick run inside it.
 */
export function buildConventionSkillBody({ repoName, skillName, conventions }: SkillBodyInput): string {
  const seen = new Map<string, number>();
  const sections = conventions.map((c) => {
    const base = ruleHeading(c.rule);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const heading = n === 1 ? base : `${base}-${n}`;
    const evidence = c.evidence.map(evidenceBlock).join("\n\n");
    return [`## ${heading}`, c.rule.trim(), evidence].filter(Boolean).join("\n\n");
  });
  const preamble =
    `House conventions for \`${repoName.replace(/`/g, "'")}\`. Flag changes that violate any rule below ` +
    "and cite the offending `file:line`. A rule the diff does not touch is not a finding.";
  return `${[`# ${skillName}`, preamble, ...sections].join("\n\n")}\n`;
}

// ---- budget (AC-44, V15) ----

const utf8 = new TextEncoder();

/** UTF-8 bytes of a body — the unit the server budgets in. */
export function bodyBytes(body: string): number {
  return utf8.encode(body).length;
}

/**
 * Bytes an agent's skills already spend of its 24 KB: only links that are
 * enabled AND point at an enabled skill count, exactly as the server counts them.
 */
export function usedBudgetBytes(links: readonly AgentSkillLink[], skills: readonly SkillListItem[]): number {
  const byId = new Map(skills.map((s) => [s.id, s]));
  return links.reduce((sum, l) => {
    const skill = l.enabled ? byId.get(l.skill_id) : undefined;
    return skill?.enabled ? sum + bodyBytes(skill.body) : sum;
  }, 0);
}

export interface AgentBudget {
  agentId: string;
  /** Bytes left of the 24 KB before the new skill; negative if the agent is already over. */
  remaining: number;
  /** True when the new skill would push this agent past the budget. */
  over: boolean;
}

/**
 * Per-agent room for the new body. `over` is only ever true for an ENABLED
 * skill: a disabled one never reaches a prompt, so the server does not count it.
 */
export function agentBudgets(
  agentIds: readonly string[],
  linksByAgent: ReadonlyMap<string, readonly AgentSkillLink[]>,
  skills: readonly SkillListItem[],
  body: string,
  enabled: boolean,
): AgentBudget[] {
  const size = bodyBytes(body);
  return agentIds.flatMap((agentId) => {
    const links = linksByAgent.get(agentId);
    if (!links) return [];
    const remaining = AGENT_SKILLS_BUDGET_BYTES - usedBudgetBytes(links, skills);
    return [{ agentId, remaining, over: enabled && size > remaining }];
  });
}

/** Human size: `812 B`, `3.4 KB`. */
export function formatBytes(bytes: number): string {
  if (Math.abs(bytes) < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
