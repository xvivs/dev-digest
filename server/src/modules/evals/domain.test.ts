/**
 * ADR 0017 scoring + verdict rules, as pure functions (plan Phase 3, TDD).
 * No DB, no LLM: findings and runs are literals.
 */
import { describe, it, expect } from 'vitest';
import type { EvalExpectation, Finding } from '@devdigest/shared';
import {
  armSkills,
  assertEvalTrusted,
  assertJobLimit,
  assertWithinBudget,
  citationAccuracyOf,
  classifyCase,
  estimateJob,
  isSuiteStale,
  jobTimeoutMs,
  worstCaseCallMs,
  LLM_LIMITS,
  EVAL_JOB_TIMEOUT_HEADROOM_MS,
  LINE_TOLERANCE,
  matchesMustFind,
  matchesMustNotFind,
  pickDefaultCarrier,
  scoreRun,
  suiteCost,
  summarizeSuite,
  unifiedDiffFromPatches,
  verdictFor,
  EVAL_CHUNK_TIMEOUT_MS,
  type EvalRunRecord,
} from './domain.js';

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f1',
  severity: 'WARNING',
  category: 'security',
  title: 'Hardcoded Stripe key',
  file: 'src/config.ts',
  start_line: 11,
  end_line: 11,
  rationale: 'A live secret is committed to the repo.',
  suggestion: null,
  confidence: 0.9,
  ...over,
});

const mustFind = {
  file: 'src/config.ts',
  line_range: { start: 10, end: 12 },
  min_severity: 'WARNING' as const,
  category: 'security' as const,
};

describe('matchesMustFind', () => {
  it('matches same file, lines in range, severity and category', () => {
    expect(matchesMustFind(finding(), mustFind)).toBe(true);
  });

  it(`tolerates ±${LINE_TOLERANCE} lines around the range, not more`, () => {
    expect(matchesMustFind(finding({ start_line: 15, end_line: 15 }), mustFind)).toBe(true);
    expect(matchesMustFind(finding({ start_line: 16, end_line: 16 }), mustFind)).toBe(false);
    expect(matchesMustFind(finding({ start_line: 7, end_line: 7 }), mustFind)).toBe(true);
    expect(matchesMustFind(finding({ start_line: 6, end_line: 6 }), mustFind)).toBe(false);
  });

  it('a finding range that spans the expected range matches', () => {
    expect(matchesMustFind(finding({ start_line: 1, end_line: 40 }), mustFind)).toBe(true);
  });

  it('any line matches when line_range is omitted', () => {
    const { line_range: _omit, ...noRange } = mustFind;
    expect(matchesMustFind(finding({ start_line: 900, end_line: 901 }), noRange)).toBe(true);
  });

  it('severity must be at least min_severity', () => {
    expect(matchesMustFind(finding({ severity: 'CRITICAL' }), mustFind)).toBe(true);
    expect(matchesMustFind(finding({ severity: 'SUGGESTION' }), mustFind)).toBe(false);
  });

  it('category and file must match (a/ b/ ./ prefixes are ignored)', () => {
    expect(matchesMustFind(finding({ category: 'bug' }), mustFind)).toBe(false);
    expect(matchesMustFind(finding({ file: 'src/other.ts' }), mustFind)).toBe(false);
    expect(matchesMustFind(finding({ file: 'b/src/config.ts' }), mustFind)).toBe(true);
    expect(matchesMustFind(finding(), { ...mustFind, file: './src/config.ts' })).toBe(true);
  });

  it('contains is a case-insensitive plain substring of title or body, never a regex', () => {
    expect(matchesMustFind(finding(), { ...mustFind, contains: 'stripe KEY' })).toBe(true);
    expect(matchesMustFind(finding(), { ...mustFind, contains: 'live secret' })).toBe(true);
    expect(matchesMustFind(finding({ suggestion: 'Use env vars' }), { ...mustFind, contains: 'env var' })).toBe(
      true,
    );
    expect(matchesMustFind(finding(), { ...mustFind, contains: 'Str.pe' })).toBe(false);
    expect(matchesMustFind(finding(), { ...mustFind, contains: 'password' })).toBe(false);
  });
});

describe('matchesMustNotFind', () => {
  it('matches when every given field matches; omitted fields match anything', () => {
    expect(matchesMustNotFind(finding(), { file: 'src/config.ts' })).toBe(true);
    expect(matchesMustNotFind(finding(), { file: 'src/config.ts', category: 'style' })).toBe(false);
    expect(matchesMustNotFind(finding(), { file: 'src/config.ts', min_severity: 'CRITICAL' })).toBe(false);
  });
});

describe('scoreRun', () => {
  const defect: EvalExpectation = { must_find: [mustFind], must_not_find: [] };
  const clean: EvalExpectation = { must_find: [], must_not_find: [{ file: 'src/config.ts' }] };

  it('defect case passes when every must_find matches; extras count as unexpected', () => {
    const s = scoreRun([finding(), finding({ id: 'f2', category: 'style', title: 'Nit' })], defect);
    expect(s).toEqual({ pass: true, matched: 1, expected: 1, unexpected: 1 });
  });

  it('defect case fails when a must_find is missing', () => {
    expect(scoreRun([], defect)).toEqual({ pass: false, matched: 0, expected: 1, unexpected: 0 });
  });

  it('clean case passes with no matching finding and fails on one', () => {
    expect(scoreRun([finding({ file: 'src/other.ts' })], clean)).toEqual({
      pass: true,
      matched: 0,
      expected: 0,
      unexpected: 1,
    });
    expect(scoreRun([finding()], clean).pass).toBe(false);
  });
});

describe('citationAccuracyOf', () => {
  it('reads the grounding summary; 0/0 is null', () => {
    expect(citationAccuracyOf('3/4 passed')).toBe(0.75);
    expect(citationAccuracyOf('0/0 passed')).toBeNull();
    expect(citationAccuracyOf('garbage')).toBeNull();
  });
});

// ---- per-case classification -------------------------------------------

type RunLite = Pick<EvalRunRecord, 'arm' | 'status' | 'pass' | 'unexpected'>;
const run = (arm: 'with' | 'without', pass: boolean, unexpected = 0): RunLite => ({
  arm,
  status: 'done',
  pass,
  unexpected,
});
const arms = (w: boolean[], wo: boolean[]): RunLite[] => [
  ...w.map((p) => run('with', p)),
  ...wo.map((p) => run('without', p)),
];

describe('classifyCase', () => {
  it('caught: passes stably only with the skill', () => {
    const c = classifyCase(arms([true, true, true], [false, false, false]), 3);
    expect(c.outcome).toBe('caught');
    expect(c.with).toEqual({ passed: 3, total: 3 });
    expect(c.without).toEqual({ passed: 0, total: 3 });
  });

  it('regressed, pass_both, fail_both', () => {
    expect(classifyCase(arms([false, false, false], [true, true, true]), 3).outcome).toBe('regressed');
    expect(classifyCase(arms([true, true, true], [true, true, true]), 3).outcome).toBe('pass_both');
    expect(classifyCase(arms([false, false, false], [false, false, false]), 3).outcome).toBe('fail_both');
  });

  it('flaky when repeats disagree within one arm', () => {
    expect(classifyCase(arms([true, false, true], [false, false, false]), 3).outcome).toBe('flaky');
    expect(classifyCase(arms([true, true, true], [false, true, false]), 3).outcome).toBe('flaky');
  });

  it('Quick (1 repeat) can never be flaky', () => {
    expect(classifyCase(arms([true], [false]), 1).outcome).toBe('caught');
  });

  it('pending until every repeat of both arms is done; error when any job failed', () => {
    expect(classifyCase(arms([true, true], [false, false, false]), 3).outcome).toBe('pending');
    const failed: RunLite = { arm: 'with', status: 'failed', pass: null, unexpected: null };
    expect(classifyCase([failed, ...arms([true, true], [false, false, false])], 3).outcome).toBe('error');
  });
});

describe('verdictFor', () => {
  const base = { mode: 'full' as const, nonFlaky: 5, caught: 1, regressed: 0, deltaUnexpected: 0 };

  it('helps: caught ≥ 1, regressed = 0, Δunexpected ≤ 1', () => {
    expect(verdictFor(base)).toBe('helps');
    expect(verdictFor({ ...base, deltaUnexpected: 1 })).toBe('helps');
  });

  it('hurts: regressed > caught, or Δunexpected > 2', () => {
    expect(verdictFor({ ...base, caught: 0, regressed: 1 })).toBe('hurts');
    expect(verdictFor({ ...base, deltaUnexpected: 2.1 })).toBe('hurts');
  });

  it('neutral otherwise', () => {
    expect(verdictFor({ ...base, caught: 0 })).toBe('neutral');
    expect(verdictFor({ ...base, caught: 2, regressed: 1 })).toBe('neutral');
    expect(verdictFor({ ...base, deltaUnexpected: 1.5 })).toBe('neutral');
  });

  it('fewer than 5 non-flaky cases is indicative', () => {
    expect(verdictFor({ ...base, nonFlaky: 4 })).toBe('indicative');
  });

  it('Quick never yields a verdict, however clear the result', () => {
    expect(verdictFor({ ...base, mode: 'quick', nonFlaky: 25, caught: 25 })).toBe('indicative');
  });
});

describe('summarizeSuite', () => {
  const cases = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: `case ${id}` }));
  const caught = arms([true, true, true], [false, false, false]);
  const both = arms([true, true, true], [true, true, true]);
  const flaky = arms([true, false, true], [false, false, false]);

  it('aggregates per case: passing, caught, regressed, flaky, verdict', () => {
    const runs = [
      ...caught.map((r) => ({ ...r, caseId: 'a' })),
      ...both.map((r) => ({ ...r, caseId: 'b' })),
      ...both.map((r) => ({ ...r, caseId: 'c' })),
      ...both.map((r) => ({ ...r, caseId: 'd' })),
      ...both.map((r) => ({ ...r, caseId: 'e' })),
      ...flaky.map((r) => ({ ...r, caseId: 'f' })),
    ];
    const { results, cases: rows } = summarizeSuite({ mode: 'full', repeats: 3, cases, runs });
    expect(results).toEqual({
      passing: 5,
      total: 6,
      caught: 1,
      regressed: 0,
      flaky: 1,
      errored: 0,
      delta_unexpected: 0,
      verdict: 'helps',
    });
    expect(rows.find((r) => r.case_id === 'f')?.outcome).toBe('flaky');
  });

  it('Δunexpected = mean unexpected with minus without, over settled cases', () => {
    const runs = cases.slice(0, 1).flatMap((c) => [
      { ...run('with', true, 4), caseId: c.id },
      { ...run('without', true, 1), caseId: c.id },
    ]);
    const { results } = summarizeSuite({ mode: 'quick', repeats: 1, cases: cases.slice(0, 1), runs });
    expect(results.delta_unexpected).toBe(3);
    expect(results.verdict).toBe('indicative');
  });

  it('a Quick suite on many clear cases is still indicative', () => {
    const runs = cases.flatMap((c) => [
      { ...run('with', true), caseId: c.id },
      { ...run('without', false), caseId: c.id },
    ]);
    const { results } = summarizeSuite({ mode: 'quick', repeats: 1, cases, runs });
    expect(results.caught).toBe(6);
    expect(results.verdict).toBe('indicative');
  });
});

describe('summarizeSuite with errored cases', () => {
  const cases = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id, name: `case ${id}` }));
  const both = arms([true, true, true], [true, true, true]);
  const failedRun = (caseId: string): RunLite & { caseId: string } => ({
    arm: 'with',
    status: 'failed',
    pass: null,
    unexpected: null,
    caseId,
  });
  // 5 settled pass_both cases + one caught + one errored (with arm failed, without ok).
  const settled = ['a', 'b', 'c', 'd', 'e'].flatMap((id) => both.map((r) => ({ ...r, caseId: id })));
  const caughtF = arms([true, true, true], [false, false, false]).map((r) => ({ ...r, caseId: 'f' }));
  const erroredG = [failedRun('g'), ...arms([], [true, true, true]).map((r) => ({ ...r, caseId: 'g' }))];

  it('an errored case is counted as errored, not as failing', () => {
    const { results, cases: rows } = summarizeSuite({
      mode: 'full',
      repeats: 3,
      cases,
      runs: [...settled, ...caughtF, ...erroredG],
    });
    expect(rows.find((r) => r.case_id === 'g')?.outcome).toBe('error');
    expect(results.errored).toBe(1);
    // passing / total are over settled cases only: 6 of 6, never 6 of 7
    expect(results.passing).toBe(6);
    expect(results.total).toBe(6);
  });

  it('an error can never lower passing, even when its with-arm runs all passed', () => {
    const withOkWithoutFailed = [
      ...arms([true, true, true], [true, true]).map((r) => ({ ...r, caseId: 'g' })),
      { arm: 'without' as const, status: 'failed' as const, pass: null, unexpected: null, caseId: 'g' },
    ];
    const base = summarizeSuite({ mode: 'full', repeats: 3, cases, runs: [...settled, ...caughtF] });
    const withErr = summarizeSuite({
      mode: 'full',
      repeats: 3,
      cases,
      runs: [...settled, ...caughtF, ...withOkWithoutFailed],
    });
    expect(withErr.results.passing).toBe(base.results.passing);
    expect(withErr.results.total).toBe(base.results.total);
    expect(withErr.results.errored).toBe(1);
  });

  it('verdict, caught and Δunexpected ignore error rows', () => {
    const clean = summarizeSuite({ mode: 'full', repeats: 3, cases, runs: [...settled, ...caughtF] });
    const withErr = summarizeSuite({
      mode: 'full',
      repeats: 3,
      cases,
      runs: [...settled, ...caughtF, ...erroredG.map((r) => ({ ...r, unexpected: r.arm === 'without' ? 99 : null }))],
    });
    expect(withErr.results.verdict).toBe(clean.results.verdict);
    expect(withErr.results.caught).toBe(clean.results.caught);
    expect(withErr.results.delta_unexpected).toBe(clean.results.delta_unexpected);
  });

  it('too many errors leave fewer than 5 settled non-flaky cases → indicative', () => {
    const { results } = summarizeSuite({
      mode: 'full',
      repeats: 3,
      cases,
      runs: [...settled.filter((r) => r.caseId !== 'e' && r.caseId !== 'd'), ...caughtF, ...erroredG],
    });
    expect(results.verdict).toBe('indicative');
    expect(results.errored).toBe(1);
  });
});

describe('suiteCost', () => {
  it('sums done runs; any estimated makes the sum estimated', () => {
    expect(
      suiteCost([
        { status: 'done', costUsd: 0.01, costSource: 'provider' },
        { status: 'done', costUsd: 0.02, costSource: 'estimated' },
        { status: 'failed', costUsd: null, costSource: null },
      ]),
    ).toEqual({ costUsd: 0.03, costSource: 'estimated' });
  });

  it('a done run with no cost makes the whole sum unknown; no done runs = null', () => {
    expect(
      suiteCost([
        { status: 'done', costUsd: 0.01, costSource: 'provider' },
        { status: 'done', costUsd: null, costSource: null },
      ]),
    ).toEqual({ costUsd: null, costSource: null });
    expect(suiteCost([{ status: 'failed', costUsd: null, costSource: null }])).toEqual({
      costUsd: null,
      costSource: null,
    });
  });
});

describe('guards', () => {
  it('trust gate: a non-manual skill needs a vet matching the target body', () => {
    expect(() => assertEvalTrusted({ source: 'manual', vettedBodyHash: null }, 'h')).not.toThrow();
    expect(() => assertEvalTrusted({ source: 'imported', vettedBodyHash: 'h' }, 'h')).not.toThrow();
    expect(() => assertEvalTrusted({ source: 'imported', vettedBodyHash: 'old' }, 'h')).toThrow(
      expect.objectContaining({ code: 'eval_skill_not_vetted', statusCode: 409 }),
    );
    expect(() => assertEvalTrusted({ source: 'imported', vettedBodyHash: null }, 'h')).toThrow(
      expect.objectContaining({ code: 'eval_skill_not_vetted' }),
    );
  });

  it('job cap: cases × 2 × repeats ≤ 150', () => {
    expect(() => assertJobLimit(25, 3)).not.toThrow();
    expect(() => assertJobLimit(26, 3)).toThrow(expect.objectContaining({ code: 'eval_too_many_jobs', statusCode: 422 }));
  });

  it('budget: estimate above the cap is refused', () => {
    expect(() => assertWithinBudget(5, 5)).not.toThrow();
    expect(() => assertWithinBudget(5.01, 5)).toThrow(
      expect.objectContaining({ code: 'eval_budget_exceeded', statusCode: 422 }),
    );
  });
});

describe('isSuiteStale', () => {
  const suite = { promptSha256: 'p1', carrierAgentVersion: 2 };
  it('stale when the prompt hash or the carrier version moved, or the carrier is gone', () => {
    expect(isSuiteStale(suite, { promptSha256: 'p1', carrierVersion: 2 })).toBe(false);
    expect(isSuiteStale(suite, { promptSha256: 'p2', carrierVersion: 2 })).toBe(true);
    expect(isSuiteStale(suite, { promptSha256: 'p1', carrierVersion: 3 })).toBe(true);
    expect(isSuiteStale(suite, { promptSha256: 'p1', carrierVersion: null })).toBe(true);
  });
});

describe('pickDefaultCarrier', () => {
  it('the agent with the most runs with the skill; ties by name', () => {
    expect(
      pickDefaultCarrier([
        { agentId: 'a', agentName: 'zeta', runs: 3 },
        { agentId: 'b', agentName: 'alpha', runs: 7 },
        { agentId: 'c', agentName: 'beta', runs: 7 },
      ]),
    ).toBe('b');
    expect(pickDefaultCarrier([])).toBeNull();
  });
});

describe('armSkills', () => {
  const target = { id: 't', name: 'target', body: 'T@v2' };
  it('with = carrier skills with the target pinned in its link position; without drops it', () => {
    const carrier = [
      { id: 'x', name: 'x', body: 'X' },
      { id: 't', name: 'target', body: 'T@current' },
      { id: 'y', name: 'y', body: 'Y' },
    ];
    expect(armSkills(carrier, target, 'with').map((s) => s.body)).toEqual(['X', 'T@v2', 'Y']);
    expect(armSkills(carrier, target, 'without').map((s) => s.id)).toEqual(['x', 'y']);
  });
  it('appends the target when the carrier does not link it', () => {
    expect(armSkills([{ id: 'x', name: 'x', body: 'X' }], target, 'with').map((s) => s.id)).toEqual(['x', 't']);
  });
});

describe('estimateJob', () => {
  const files = [
    { path: 'a.ts', additions: 300, deletions: 0 },
    { path: 'b.ts', additions: 300, deletions: 0 },
  ];
  it('single-pass is one chunk; map-reduce is one chunk per file', () => {
    const base = { systemPrompt: 'x'.repeat(400), skillsChars: 400, diffChars: 4000, files };
    const single = estimateJob({ ...base, strategy: 'single-pass' });
    const mapped = estimateJob({ ...base, strategy: 'map-reduce' });
    expect(single.chunks).toBe(1);
    expect(mapped.chunks).toBe(2);
    expect(mapped.tokensIn).toBeGreaterThan(single.tokensIn);
    expect(mapped.tokensOut).toBe(2 * single.tokensOut);
  });
  it('auto maps only a large multi-file diff', () => {
    const base = { systemPrompt: '', skillsChars: 0, diffChars: 100, strategy: 'auto' as const };
    expect(estimateJob({ ...base, files }).chunks).toBe(2);
    expect(estimateJob({ ...base, files: files.slice(0, 1) }).chunks).toBe(1);
  });
  it('the job timeout grows with chunks', () => {
    expect(jobTimeoutMs(3)).toBeGreaterThan(3 * EVAL_CHUNK_TIMEOUT_MS);
  });
});

describe('worstCaseCallMs / jobTimeoutMs', () => {
  const l = { callTimeoutMs: 1000, transientRetries: 3, baseDelayMs: 100, maxDelayMs: 250, structuredRetries: 2 };

  it('= structured attempts × (transient attempts × call timeout + backoff incl. jitter)', () => {
    // backoff per structured attempt: min(250,100)+min(250,200)+min(250,400) = 550, + 3 × 100 jitter = 850
    expect(worstCaseCallMs(l)).toBe(3 * (4 * 1000 + 850));
  });

  it('no retries at all is one bare call', () => {
    expect(worstCaseCallMs({ ...l, transientRetries: 0, structuredRetries: 0 })).toBe(1000);
  });

  it('the shipped limits cover the >12 min a slow model really takes (60 s × 4 × 3)', () => {
    expect(worstCaseCallMs(LLM_LIMITS)).toBeGreaterThanOrEqual(12 * 60_000);
    expect(EVAL_CHUNK_TIMEOUT_MS).toBe(worstCaseCallMs(LLM_LIMITS));
  });

  it('job timeout = chunks × per-chunk worst case + headroom; at least one chunk', () => {
    expect(jobTimeoutMs(2, l)).toBe(2 * worstCaseCallMs(l) + EVAL_JOB_TIMEOUT_HEADROOM_MS);
    expect(jobTimeoutMs(0, l)).toBe(worstCaseCallMs(l) + EVAL_JOB_TIMEOUT_HEADROOM_MS);
  });
});

describe('unifiedDiffFromPatches', () => {
  it('rebuilds a git-style diff for the chosen files only', () => {
    const raw = unifiedDiffFromPatches([
      { path: 'src/a.ts', patch: '@@ -1 +1 @@\n-a\n+b' },
      { path: 'src/b.ts', patch: '@@ -1 +1 @@\n-c\n+d' },
    ]);
    expect(raw).toContain('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@');
    expect(raw).toContain('+++ b/src/b.ts');
  });
});
