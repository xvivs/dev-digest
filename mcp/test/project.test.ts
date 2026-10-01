import { describe, expect, it } from 'vitest';
import type { ConventionsLite, PrBlastLite, FindingLite, ReviewLite, RunLite } from '../src/api/schemas.js';
import {
  CONVENTIONS_MAX,
  newerRunInProgress,
  blastNextStep,
  projectAgents,
  projectBlastRadius,
  projectConventions,
  projectNoReview,
  projectReviewFindings,
  projectRunningFindings,
  selectFindings,
  selectReview,
} from '../src/project.js';
import { runPhase } from '../src/run-status.js';
import { AgentLite } from '../src/api/schemas.js';
import { agentJson } from './fixtures.js';

function finding(overrides: Partial<FindingLite> = {}): FindingLite {
  return {
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'a.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'r',
    suggestion: 's',
    confidence: 0.5,
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function review(overrides: Partial<ReviewLite> = {}): ReviewLite {
  return {
    id: 'rev-a',
    run_id: 'run-a',
    agent_name: 'A',
    verdict: 'comment',
    summary: 'sum',
    score: 70,
    created_at: '2026-10-01T10:05:00.000Z',
    findings: [],
    ...overrides,
  };
}

function run(overrides: Partial<RunLite> = {}): RunLite {
  return {
    run_id: 'run-a',
    agent_id: 'ag',
    agent_name: 'A',
    status: 'done',
    error: null,
    duration_ms: 1,
    findings_count: 0,
    cost_usd: null,
    ran_at: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('runPhase', () => {
  it.each([
    ['done', 'done'],
    ['failed', 'failed'],
    ['cancelled', 'failed'],
    ['running', 'pending'],
    [null, 'pending'],
    ['weird', 'pending'],
  ] as const)('%s → %s', (status, phase) => {
    expect(runPhase(status)).toBe(phase);
  });
});

describe('selectReview (AC-15)', () => {
  const newest = review({ id: 'new', run_id: 'run-b' });
  const older = review({ id: 'old', run_id: 'run-a' });

  it('without runId picks the newest review', () => {
    expect(selectReview([], [newest, older])).toEqual({ kind: 'review', review: newest });
  });

  it('gives none without reviews', () => {
    expect(selectReview([run()], [])).toEqual({ kind: 'none' });
  });

  it('selects the review of a done run', () => {
    expect(selectReview([run({ run_id: 'run-a' })], [newest, older], 'run-a')).toEqual({
      kind: 'review',
      review: older,
    });
  });

  it('gives running for a running run and for a null status', () => {
    expect(selectReview([run({ status: 'running' })], [], 'run-a').kind).toBe('running');
    expect(selectReview([run({ status: null })], [], 'run-a').kind).toBe('running');
  });

  it('gives failed for failed and for cancelled', () => {
    expect(selectReview([run({ status: 'failed' })], [], 'run-a').kind).toBe('failed');
    expect(selectReview([run({ status: 'cancelled' })], [], 'run-a').kind).toBe('failed');
  });

  it('gives run_not_found for an unknown run id', () => {
    expect(selectReview([run()], [older], 'run-x')).toEqual({ kind: 'run_not_found' });
  });

  it('gives review_not_found for a done run whose review is gone', () => {
    expect(selectReview([run()], [newest], 'run-a').kind).toBe('review_not_found');
  });
});

describe('newerRunInProgress (AC-15)', () => {
  const rev = review({ run_id: 'run-a', created_at: '2026-10-01T10:05:00.000Z' });
  const ownRun = run({ run_id: 'run-a', ran_at: '2026-10-01T10:00:00.000Z' });

  it('reports a pending run that started after the review', () => {
    const pending = run({ run_id: 'run-b', status: 'running', agent_name: 'B', ran_at: '2026-10-01T10:06:00.000Z' });
    expect(newerRunInProgress([pending, ownRun], rev)).toEqual({ run_id: 'run-b', agent: 'B' });
  });

  it('ignores a pending run older than the review\'s run', () => {
    const pending = run({ run_id: 'run-b', status: 'running', ran_at: '2026-10-01T09:00:00.000Z' });
    expect(newerRunInProgress([ownRun, pending], rev)).toBeNull();
  });

  it('counts a concurrent run that started after A started but before A\'s review was written', () => {
    const b = run({ run_id: 'run-b', status: 'running', agent_name: 'B', ran_at: '2026-10-01T10:02:00.000Z' });
    expect(newerRunInProgress([b, ownRun], rev)).toEqual({ run_id: 'run-b', agent: 'B' });
  });

  it('counts a pending run with a null ran_at as newer', () => {
    const b = run({ run_id: 'run-b', status: 'running', ran_at: null });
    expect(newerRunInProgress([b, ownRun], rev)).toMatchObject({ run_id: 'run-b' });
  });

  it('falls back to the review created_at when its run is missing', () => {
    const b = run({ run_id: 'run-b', status: 'running', ran_at: '2026-10-01T10:02:00.000Z' });
    expect(newerRunInProgress([b], rev)).toBeNull();
    const c = run({ run_id: 'run-c', status: 'running', ran_at: '2026-10-01T10:06:00.000Z' });
    expect(newerRunInProgress([c], rev)).toMatchObject({ run_id: 'run-c' });
  });

  it('is null when only done or failed runs exist', () => {
    const b = run({ run_id: 'run-b', status: 'done', ran_at: '2026-10-01T11:00:00.000Z' });
    const c = run({ run_id: 'run-c', status: 'failed', ran_at: '2026-10-01T11:00:00.000Z' });
    expect(newerRunInProgress([b, c, ownRun], rev)).toBeNull();
  });

  it('counts any pending run when there is no review, and maps a null agent_name to null', () => {
    const b = run({ run_id: 'run-b', status: 'running', agent_name: null, ran_at: '2020-01-01T00:00:00.000Z' });
    expect(newerRunInProgress([b], null)).toEqual({ run_id: 'run-b', agent: null });
  });
});

describe('projectAgents (AC-4)', () => {
  it('keeps only the five fields, sorted by name', () => {
    const parsed = [agentJson({ id: '2', name: 'Zed' }), agentJson({ id: '1', name: 'Alpha' })].map((a) =>
      AgentLite.parse(a),
    );
    const out = projectAgents(parsed);
    expect(out.agents.map((a) => a.name)).toEqual(['Alpha', 'Zed']);
    expect(Object.keys(out.agents[0]!).sort()).toEqual(['description', 'enabled', 'id', 'model', 'name']);
    expect(JSON.stringify(out)).not.toContain('SECRET PROMPT');
  });
});

describe('findings projection (AC-16)', () => {
  const findings = [
    finding({ severity: 'SUGGESTION', file: 'a.ts' }),
    finding({ severity: 'CRITICAL', file: 'b.ts', start_line: 9 }),
    finding({ severity: 'WARNING', file: 'a.ts' }),
    finding({ severity: 'CRITICAL', file: 'b.ts', start_line: 2 }),
    finding({ severity: 'CRITICAL', file: 'a.ts', start_line: 5 }),
  ];

  it('sorts by severity, then file, then start_line', () => {
    const out = selectFindings(findings, { limit: 50 });
    expect(out.findings.map((f) => `${f.severity}:${f.file}:${f.start_line}`)).toEqual([
      'CRITICAL:a.ts:5',
      'CRITICAL:b.ts:2',
      'CRITICAL:b.ts:9',
      'WARNING:a.ts:1',
      'SUGGESTION:a.ts:1',
    ]);
  });

  it('min_severity WARNING keeps CRITICAL and WARNING; counts stay unfiltered', () => {
    const out = selectFindings(findings, { minSeverity: 'WARNING', limit: 50 });
    expect(out.findings.map((f) => f.severity)).not.toContain('SUGGESTION');
    expect(out.findings).toHaveLength(4);
    expect(out.counts).toEqual({ CRITICAL: 3, WARNING: 1, SUGGESTION: 1 });
    expect(out.truncated).toBe(false);
  });

  it('limit caps and sets truncated', () => {
    const out = selectFindings(findings, { limit: 2 });
    expect(out.findings).toHaveLength(2);
    expect(out.truncated).toBe(true);
    expect(out.counts.CRITICAL).toBe(3);
  });

  it('cuts rationale at 600 and suggestion at 300 with …', () => {
    const [f] = selectFindings([finding({ rationale: 'x'.repeat(1000), suggestion: 'y'.repeat(301) })], {
      limit: 1,
    }).findings;
    expect(f!.rationale).toHaveLength(600);
    expect(f!.rationale.endsWith('…')).toBe(true);
    expect(f!.suggestion).toHaveLength(300);
    expect(f!.suggestion!.endsWith('…')).toBe(true);
    const [g] = selectFindings([finding({ rationale: 'x'.repeat(600) })], { limit: 1 }).findings;
    expect(g!.rationale).toBe('x'.repeat(600));
  });

  it('cuts title at 200 and summary at 1500 with …', () => {
    const out = projectReviewFindings(
      review({ summary: 's'.repeat(5000), findings: [finding({ title: 't'.repeat(1000) })] }),
      { limit: 20 },
      null,
    );
    expect(out.summary).toHaveLength(1500);
    expect(out.summary!.endsWith('…')).toBe(true);
    expect(out.findings[0]!.title).toHaveLength(200);
    expect(out.findings[0]!.title.endsWith('…')).toBe(true);
  });

  it('omits a null suggestion and derives state from the timestamps', () => {
    const out = selectFindings(
      [
        finding({ suggestion: null, file: 'a' }),
        finding({ accepted_at: '2026-10-01T00:00:00Z', file: 'b' }),
        finding({ dismissed_at: '2026-10-01T00:00:00Z', file: 'c' }),
      ],
      { limit: 10 },
    );
    expect('suggestion' in out.findings[0]!).toBe(false);
    expect(out.findings.map((f) => f.state)).toEqual(['open', 'accepted', 'dismissed']);
  });

  it('maps an undefined agent_name to agent: null and keeps nulls', () => {
    const out = projectReviewFindings(
      review({ agent_name: undefined, verdict: null, score: null, summary: null }),
      { limit: 20 },
      null,
    );
    expect(out).toMatchObject({ status: 'done', agent: null, verdict: null, score: null, summary: null });
    expect(out.newer_run_in_progress).toBeNull();
    expect(out.next_step).toBeUndefined();
  });

  it('sets next_step when a newer run is in progress', () => {
    const out = projectReviewFindings(review(), { limit: 20 }, { run_id: 'run-b', agent: 'B' });
    expect(out.next_step).toContain('run_id run-b');
  });

  it('running and none outputs carry a next step', () => {
    expect(projectRunningFindings(run({ status: 'running' })).next_step).toContain('run_id run-a');
    expect(projectNoReview(null)).toMatchObject({ status: 'none', run_id: null });
    expect(projectNoReview(null).next_step).toContain('run_agent_on_pr');
  });
});

describe('projectConventions (AC-17)', () => {
  const evidence = [
    { path: 'a', line_start: 1 },
    { path: 'b', line_start: 2 },
    { path: 'c', line_start: 3 },
  ];
  const page: ConventionsLite = {
    last_scan: { status: 'done', finished_at: '2026-10-01T00:00:00Z' },
    candidates: [
      { status: 'accepted', rule: 'r1', confidence: 0.9, category: 'naming', evidence },
      { status: 'pending', rule: 'r2', confidence: 0.5, category: 'naming', evidence: [] },
      { status: 'accepted', rule: 'r3', confidence: 0.7, category: 'async', evidence: [] },
    ],
  };

  it('returns accepted rules by default with at most 2 evidence items and the scan', () => {
    const out = projectConventions(page, { status: 'accepted' });
    expect(out.rules.map((r) => r.rule)).toEqual(['r1', 'r3']);
    expect(out.rules[0]!.evidence).toEqual([
      { path: 'a', line_start: 1 },
      { path: 'b', line_start: 2 },
    ]);
    expect(out.scan).toEqual({ status: 'done', finished_at: '2026-10-01T00:00:00Z' });
    expect(out.next_step).toBeUndefined();
  });

  it('status all includes pending; category filters', () => {
    expect(projectConventions(page, { status: 'all' }).rules).toHaveLength(3);
    expect(projectConventions(page, { status: 'all', category: 'naming' }).rules.map((r) => r.rule)).toEqual([
      'r1',
      'r2',
    ]);
  });

  it('caps at 50 rules and cuts a rule at 400 chars', () => {
    const many: ConventionsLite = {
      last_scan: null,
      candidates: Array.from({ length: 60 }, () => ({
        status: 'accepted' as const,
        rule: 'z'.repeat(500),
        confidence: 1,
        category: 'other',
        evidence: [],
      })),
    };
    const out = projectConventions(many, { status: 'accepted' });
    expect(out.rules).toHaveLength(CONVENTIONS_MAX);
    expect(out.truncated).toBe(true);
    expect(out.rules[0]!.rule).toHaveLength(400);
    expect(out.scan).toBeNull();
  });

  it('adds a next_step when no rules match', () => {
    const out = projectConventions(page, { status: 'accepted', category: 'nothing' });
    expect(out.rules).toEqual([]);
    expect(out.next_step).toMatch(/extraction/);
  });
});

describe('projectBlastRadius / blastNextStep', () => {
  const base: PrBlastLite = { status: 'ok', reason: null, head_sha: 'h', source_sha: 's', truncated: false, blast: null };

  it('null blast → null summary and empty lists', () => {
    const out = projectBlastRadius('acme/shop', 3, base);
    expect(out).toMatchObject({ repo: 'acme/shop', pr_number: 3, summary: null, changed_symbols: [], downstream: [], head_sha: 'h', source_sha: 's' });
  });

  it('keeps downstream and caller order and adds no cap', () => {
    const downstream = Array.from({ length: 30 }, (_, i) => ({
      symbol: `s${30 - i}`,
      callers: [{ name: 'c', file: 'f.ts', line: i + 1 }],
      endpoints_affected: [],
      crons_affected: [],
    }));
    const out = projectBlastRadius('a/b', 1, { ...base, blast: { summary: 's', changed_symbols: [], downstream } });
    expect(out.downstream.map((d) => d.symbol)).toEqual(downstream.map((d) => d.symbol));
  });

  it('next_step per D9 row', () => {
    const step = (status: PrBlastLite['status'], reason: PrBlastLite['reason'], truncated = false) =>
      blastNextStep({ ...base, status, reason, truncated });
    expect(step('unavailable', 'no_changed_files')).toMatch(/Open the PR in the DevDigest UI/);
    for (const r of ['index_partial', 'index_failed', 'no_index', 'no_data'] as const) {
      expect(step('degraded', r)).toContain(`(${r})`);
      expect(step('degraded', r)).toContain('Resync');
    }
    expect(step('degraded', 'repo_too_large')).toMatch(/too large/);
    expect(step('degraded', 'flag_off')).toContain('REPO_INTEL_ENABLED=false');
    expect(step('ok', null, true)).toMatch(/capped per symbol/);
    expect(step('ok', null)).toBeUndefined();
    expect(projectBlastRadius('a/b', 1, base)).not.toHaveProperty('next_step');
  });
});
