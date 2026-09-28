import type { LogLine } from "@devdigest/ui";
import type { RunTrace } from "@devdigest/shared";

interface RawEvent {
  t: string;
  kind: string;
  msg: string;
}

/** Map run-bus events to the LiveLogStream LogLine shape. */
export function eventsToLog(events: RawEvent[]): LogLine[] {
  return events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));
}

/** Map a persisted trace's log to the LiveLogStream LogLine shape. */
export function traceLog(trace: RunTrace | undefined): LogLine[] {
  return trace?.log.map((l) => ({ t: l.t, k: l.kind as LogLine["k"], m: l.msg })) ?? [];
}

/** Seconds-formatted duration. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}

/**
 * One approximate token count (D4: `ceil(chars / 4)`, always an estimate — the
 * "≈" is load-bearing, not decoration). Used for the Skills prompt block's
 * header total and each `skills_used` entry's own count (SPEC-02 AC-27).
 */
export function formatApproxTokens(n: number): string {
  if (n < 1000) return `≈${n} tokens`;
  return `≈${(n / 1000).toFixed(1)}k tokens`;
}

/**
 * Whether a skill referenced in a trace's `skills_used` list has since been
 * deleted (AC-27). `knownSkillIds` is `null`/`undefined` while the live skills
 * list is still loading — deliberately returns `false` in that case so
 * "deleted" never flashes on a skill that simply hasn't loaded yet.
 */
export function isSkillDeleted(knownSkillIds: Set<string> | null | undefined, id: string): boolean {
  return knownSkillIds != null && !knownSkillIds.has(id);
}
