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
  caseDiffPreview,
  citationAccuracyOf,
  classifyCase,
  findingsOf,
  mapCaseArm,
  mapCaseRun,
  expectationChangedSince,
  EVAL_CASE_DIFF_PREVIEW_MAX,
  EVAL_CASE_UNEXPECTED_FINDINGS_MAX,
  type CaseRunWithOutput,
  estimateJob,
  isSuiteStale,
  jobTimeoutMs,
  worstCaseCallMs,
  LLM_LIMITS,
  EVAL_JOB_TIMEOUT_HEADROOM_MS,
  LINE_TOLERANCE,
  matchesMustFind,
  median,
  matchesMustNotFind,
  pickDefaultCarrier,
  rankCarriers,
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

describe('rankCarriers', () => {
  it('most runs first, ties by name; the first is what pickDefaultCarrier returns', () => {
    const list = [
      { agentId: 'a', agentName: 'zeta', runs: 0 },
      { agentId: 'b', agentName: 'beta', runs: 2 },
      { agentId: 'c', agentName: 'alpha', runs: 2 },
    ];
    expect(rankCarriers(list).map((c) => c.agentId)).toEqual(['c', 'b', 'a']);
    expect(pickDefaultCarrier(list)).toBe('c');
    expect(list[0]!.agentId).toBe('a'); // input untouched
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

// ---- per-case summary fields (card subtitle) ----------------------------

describe('median', () => {
  it('odd count: the middle value; even count: mean of the two middle values; empty: null', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 4])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(median([])).toBeNull();
  });
});

describe('summarizeSuite per-case summary', () => {
  const doneRun = (
    caseId: string,
    arm: 'with' | 'without',
    matched: number,
    unexpected: number,
    expected = 2,
  ): RunLite & { caseId: string; matched: number; expected: number } => ({
    caseId,
    arm,
    status: 'done',
    pass: matched === expected,
    matched,
    expected,
    unexpected,
  });

  it('with-arm medians over done repeats; without-arm runs never leak in', () => {
    const runs = [
      doneRun('a', 'with', 0, 5),
      doneRun('a', 'with', 2, 1),
      doneRun('a', 'with', 1, 3),
      doneRun('a', 'without', 2, 0),
      doneRun('a', 'without', 2, 0),
      doneRun('a', 'without', 2, 0),
    ];
    const { cases } = summarizeSuite({ mode: 'full', repeats: 3, cases: [{ id: 'a', name: 'a' }], runs });
    expect(cases[0]).toMatchObject({ expected_count: 2, matched_median: 1, unexpected_median: 3, is_clean: false });
  });

  it('a clean case (expected 0) reports is_clean and the unexpected median', () => {
    const runs = [
      doneRun('c', 'with', 0, 2, 0),
      doneRun('c', 'without', 0, 0, 0),
    ];
    const { cases } = summarizeSuite({ mode: 'quick', repeats: 1, cases: [{ id: 'c', name: 'c' }], runs });
    expect(cases[0]).toMatchObject({ expected_count: 0, matched_median: 0, unexpected_median: 2, is_clean: true });
  });

  it('no done with-arm run: medians and expected_count are null, not 0', () => {
    const queued: RunLite & { caseId: string } = { caseId: 'n', arm: 'with', status: 'queued', pass: null, unexpected: null };
    const { cases } = summarizeSuite({ mode: 'quick', repeats: 1, cases: [{ id: 'n', name: 'n' }], runs: [queued] });
    expect(cases[0]).toMatchObject({ expected_count: null, matched_median: null, unexpected_median: null, is_clean: null });
  });

  it('expected_count falls back to a done without-arm run when no with-arm run is done', () => {
    const runs = [doneRun('w', 'without', 1, 0, 3)];
    const { cases } = summarizeSuite({ mode: 'quick', repeats: 1, cases: [{ id: 'w', name: 'w' }], runs });
    expect(cases[0]).toMatchObject({ expected_count: 3, is_clean: false, matched_median: null });
  });
});

describe('summarizeSuite partial', () => {
  it('a partial suite never yields a verdict, even with 5+ clear cases (needs the full case set)', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const cases = ids.map((id) => ({ id, name: id }));
    const runs = ids.flatMap((id) => arms([true, true, true], [false, false, false]).map((r) => ({ ...r, caseId: id })));
    expect(summarizeSuite({ mode: 'full', repeats: 3, cases, runs }).results.verdict).toBe('helps');
    expect(summarizeSuite({ mode: 'full', repeats: 3, cases, runs, partial: true }).results.verdict).toBe('indicative');
  });
});

// ---- case detail mapping (the drawer) -------------------------------------

describe('findingsOf', () => {
  it('reads findings from the stored actual_output and drops anything malformed', () => {
    const good = finding();
    expect(findingsOf({ findings: [good, null, 'x', { file: 1 }], grounding: '1/1 passed' })).toEqual([good]);
    expect(findingsOf(null)).toEqual([]);
    expect(findingsOf({ findings: 'nope' })).toEqual([]);
    expect(findingsOf(undefined)).toEqual([]);
  });
});

describe('mapCaseRun', () => {
  const twoMust: EvalExpectation = {
    must_find: [
      mustFind,
      { file: 'src/other.ts', min_severity: 'WARNING', category: 'bug' },
    ],
    must_not_find: [],
  };
  const record = (over: Partial<CaseRunWithOutput> = {}): CaseRunWithOutput => ({
    id: 'r',
    suiteId: 's',
    caseId: 'c',
    arm: 'with',
    repeatIdx: 0,
    status: 'done',
    pass: false,
    matched: 1,
    expected: 2,
    unexpected: 1,
    citationAccuracy: 1,
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0.01,
    costSource: 'estimated',
    durationMs: 1234,
    error: null,
    ranAt: null,
    actualOutput: { findings: [finding(), finding({ id: 'x', file: 'src/z.ts', title: 'Stray', severity: 'SUGGESTION', category: 'style', start_line: 4 })] },
    ...over,
  });

  it('splits must_find into matched and missed indexes and lists the unexpected findings', () => {
    const d = mapCaseRun(record(), twoMust);
    expect(d).toMatchObject({
      repeat_idx: 0,
      status: 'done',
      pass: false,
      matched_must_find: [0],
      missed_must_find: [1],
      unexpected: 1,
      duration_ms: 1234,
      cost_usd: 0.01,
      cost_source: 'estimated',
      error: null,
    });
    expect(d.unexpected_findings).toEqual([
      { file: 'src/z.ts', line: 4, severity: 'SUGGESTION', category: 'style', title: 'Stray' },
    ]);
  });

  it('bounds the unexpected list, most severe first, and keeps the stored count', () => {
    const many = Array.from({ length: EVAL_CASE_UNEXPECTED_FINDINGS_MAX + 5 }, (_, i) =>
      finding({ id: `f${i}`, file: 'src/z.ts', start_line: i + 1, severity: i === 24 ? 'CRITICAL' : 'SUGGESTION', category: 'style', title: `t${i}` }),
    );
    const d = mapCaseRun(record({ unexpected: many.length, actualOutput: { findings: many } }), twoMust);
    expect(d.unexpected).toBe(many.length);
    expect(d.unexpected_findings).toHaveLength(EVAL_CASE_UNEXPECTED_FINDINGS_MAX);
    expect(d.unexpected_findings[0]?.severity).toBe('CRITICAL');
  });

  it('a failed or queued run carries the error and no match detail', () => {
    const d = mapCaseRun(
      record({ status: 'failed', pass: null, matched: null, expected: null, unexpected: null, error: 'timeout', actualOutput: null }),
      twoMust,
    );
    expect(d).toMatchObject({ status: 'failed', pass: null, matched_must_find: [], missed_must_find: [], unexpected: null, unexpected_findings: [], error: 'timeout' });
  });

  it('a legacy case with no parsed expectation gets no match detail (nothing to judge against)', () => {
    const d = mapCaseRun(record(), null);
    expect(d).toMatchObject({ matched_must_find: [], missed_must_find: [], unexpected_findings: [] });
  });
});

describe('mapCaseArm', () => {
  const rec = (arm: 'with' | 'without', repeatIdx: number, matched: number, unexpected: number, pass: boolean): CaseRunWithOutput => ({
    id: `${arm}${repeatIdx}`,
    suiteId: 's',
    caseId: 'c',
    arm,
    repeatIdx,
    status: 'done',
    pass,
    matched,
    expected: 1,
    unexpected,
    citationAccuracy: null,
    tokensIn: 1,
    tokensOut: 1,
    costUsd: null,
    costSource: null,
    durationMs: 5,
    error: null,
    ranAt: null,
    actualOutput: { findings: [] },
  });
  const exp: EvalExpectation = { must_find: [mustFind], must_not_find: [] };

  it('tally, medians and runs ordered by repeat for ONE arm', () => {
    const runs = [
      rec('with', 2, 1, 4, true),
      rec('with', 0, 0, 0, false),
      rec('with', 1, 1, 2, true),
      rec('without', 0, 0, 9, false),
    ];
    const arm = mapCaseArm(runs, 'with', 3, exp);
    expect(arm).toMatchObject({ passed: 2, total: 3, matched_median: 1, unexpected_median: 2 });
    expect(arm.runs.map((r) => r.repeat_idx)).toEqual([0, 1, 2]);
  });

  it('an arm with no runs is an empty tally, medians null', () => {
    expect(mapCaseArm([], 'without', 3, exp)).toEqual({ passed: 0, total: 3, matched_median: null, unexpected_median: null, runs: [] });
  });
});

describe('caseDiffPreview', () => {
  it('short diffs pass through whole', () => {
    expect(caseDiffPreview('abc')).toEqual({ preview: 'abc', chars: 3, truncated: false });
  });
  it('long diffs are cut at the cap and flagged, with the true size kept', () => {
    const big = 'x'.repeat(EVAL_CASE_DIFF_PREVIEW_MAX + 10);
    const r = caseDiffPreview(big);
    expect(r.preview).toHaveLength(EVAL_CASE_DIFF_PREVIEW_MAX);
    expect(r).toMatchObject({ chars: big.length, truncated: true });
  });
});

describe('expectationChangedSince', () => {
  it('true when the case was updated after the suite started', () => {
    expect(expectationChangedSince(new Date('2026-01-02'), new Date('2026-01-01'))).toBe(true);
    expect(expectationChangedSince(new Date('2026-01-01'), new Date('2026-01-02'))).toBe(false);
  });
});
