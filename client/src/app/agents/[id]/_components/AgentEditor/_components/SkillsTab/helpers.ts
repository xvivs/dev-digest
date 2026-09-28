/* SkillsTab helpers — pure logic for merging/ordering/filtering skill rows and
   for computing the next `AgentSkillLink[]` after a tick/untick/reorder. Kept
   free of React and API calls so every branch is unit-testable directly. */
import type { AgentSkillLink, SkillListItem } from "@devdigest/shared";

/** One rendered row: a workspace skill plus this agent's link state for it. */
export interface SkillRow {
  skill: SkillListItem;
  /** Whether this agent has an `agent_skills` row for this skill at all. */
  linked: boolean;
  /** `link.enabled` when linked; always `false` when not linked. */
  enabled: boolean;
  /** `link.order` when linked; `null` otherwise — unlinked rows have no position. */
  order: number | null;
}

export type MutedReason = "disabled" | "needsVetting" | null;

/** Why a row can't reach the prompt even when ticked (SPEC-02 AC-17). */
export function mutedReason(skill: SkillListItem): MutedReason {
  if (!skill.enabled) return "disabled";
  if (skill.needs_vetting) return "needsVetting";
  return null;
}

/**
 * All workspace skills, linked ones first (by `order`), then the rest by name
 * (SPEC-02 AC-13). `links` need not be pre-sorted — it is sorted by `order` here.
 */
export function buildSkillRows(
  skills: readonly SkillListItem[],
  links: readonly AgentSkillLink[],
): SkillRow[] {
  const linkBySkillId = new Map(links.map((l) => [l.skill_id, l]));
  const linked: SkillRow[] = [];
  const unlinked: SkillRow[] = [];
  for (const skill of skills) {
    const link = linkBySkillId.get(skill.id);
    if (link) linked.push({ skill, linked: true, enabled: link.enabled, order: link.order });
    else unlinked.push({ skill, linked: false, enabled: false, order: null });
  }
  linked.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  unlinked.sort((a, b) => a.skill.name.localeCompare(b.skill.name));
  return [...linked, ...unlinked];
}

/** Rows whose name matches the filter text (case-insensitive substring). */
export function filterSkillRows(rows: readonly SkillRow[], query: string): SkillRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => r.skill.name.toLowerCase().includes(q));
}

/** `{enabled} of {total} enabled` (SPEC-02 AC-14) — derived from the FULL row set, not the filtered one. */
export function countEnabledSkills(rows: readonly SkillRow[]): { enabled: number; total: number } {
  return { enabled: rows.filter((r) => r.linked && r.enabled).length, total: rows.length };
}

/**
 * Tick/untick one skill.
 * - Ticking a skill with no link yet APPENDS a new enabled link at the end.
 * - Ticking/unticking an existing link only flips `enabled` — its position never moves.
 */
export function toggleLink(
  links: readonly AgentSkillLink[],
  agentId: string,
  skillId: string,
  nextEnabled: boolean,
): AgentSkillLink[] {
  const idx = links.findIndex((l) => l.skill_id === skillId);
  if (idx === -1) {
    if (!nextEnabled) return [...links]; // untick on a skill with no link: nothing to do
    return [...links, { agent_id: agentId, skill_id: skillId, order: links.length, enabled: true }];
  }
  return links.map((l, i) => (i === idx ? { ...l, enabled: nextEnabled } : l));
}

/** Swap a linked skill with its adjacent neighbour (↑ = -1, ↓ = +1). No-op at either boundary or if unlinked. */
export function moveLink(
  links: readonly AgentSkillLink[],
  skillId: string,
  direction: -1 | 1,
): AgentSkillLink[] {
  const idx = links.findIndex((l) => l.skill_id === skillId);
  if (idx === -1) return [...links];
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= links.length) return [...links];
  const next = [...links];
  const [moved] = next.splice(idx, 1);
  if (!moved) return [...links];
  next.splice(targetIdx, 0, moved);
  return next.map((l, i) => ({ ...l, order: i }));
}

/** Move a dragged linked skill to just before/after another linked skill. No-op unless BOTH are linked. */
export function reorderLinkByDrag(
  links: readonly AgentSkillLink[],
  draggedSkillId: string,
  targetSkillId: string,
): AgentSkillLink[] {
  if (draggedSkillId === targetSkillId) return [...links];
  const fromIdx = links.findIndex((l) => l.skill_id === draggedSkillId);
  const toIdx = links.findIndex((l) => l.skill_id === targetSkillId);
  if (fromIdx === -1 || toIdx === -1) return [...links];
  const next = [...links];
  const [moved] = next.splice(fromIdx, 1);
  if (!moved) return [...links];
  next.splice(toIdx, 0, moved);
  return next.map((l, i) => ({ ...l, order: i }));
}

/** Strip client-only fields for the PUT body — `order` is implied by array index (frozen contract). */
export function toPayloadLinks(links: readonly AgentSkillLink[]): { skill_id: string; enabled: boolean }[] {
  return links.map((l) => ({ skill_id: l.skill_id, enabled: l.enabled }));
}
