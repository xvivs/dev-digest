import { describe, it, expect } from 'vitest';
import {
  CreateEvalCaseBody,
  CreateEvalSuiteBody,
  EvalCaseDetail,
  EvalCaseDetailQuery,
  EvalCaseLatestResult,
  EvalExpectation,
  EvalLineRange,
  RestoreSkillVersionBody,
  SkillListItem,
  SkillStatsQuery,
  UpdateEvalCaseBody,
  UpdateSkillBody,
} from '@devdigest/shared';

/** Contract tests for the skill-impact surface (versions, stats, evals). */

const mustFind = { file: 'src/a.ts', min_severity: 'WARNING', category: 'bug' } as const;

describe('EvalExpectation', () => {
  it('accepts a defect case and defaults must_not_find to []', () => {
    const e = EvalExpectation.parse({ must_find: [{ ...mustFind, line_range: { start: 3, end: 5 }, contains: 'null' }] });
    expect(e.must_not_find).toEqual([]);
    expect(e.must_find[0]?.line_range).toEqual({ start: 3, end: 5 });
  });

  it('accepts a clean case (must_not_find only)', () => {
    expect(EvalExpectation.safeParse({ must_not_find: [{ file: 'src/a.ts' }] }).success).toBe(true);
  });

  it('rejects an empty expectation', () => {
    expect(EvalExpectation.safeParse({}).success).toBe(false);
  });

  it('rejects must_not_find on a defect case', () => {
    const r = EvalExpectation.safeParse({ must_find: [mustFind], must_not_find: [{ file: 'src/a.ts' }] });
    expect(r.success).toBe(false);
  });

  it('is strict: unknown keys fail, at both levels', () => {
    expect(EvalExpectation.safeParse({ must_find: [mustFind], regex: '.*' }).success).toBe(false);
    expect(EvalExpectation.safeParse({ must_find: [{ ...mustFind, regex: '.*' }] }).success).toBe(false);
  });

  it('reuses Severity/FindingCategory enums', () => {
    expect(EvalExpectation.safeParse({ must_find: [{ ...mustFind, min_severity: 'HIGH' }] }).success).toBe(false);
    expect(EvalExpectation.safeParse({ must_find: [{ ...mustFind, category: 'typo' }] }).success).toBe(false);
  });

  it('line_range end must be >= start', () => {
    expect(EvalLineRange.safeParse({ start: 5, end: 4 }).success).toBe(false);
    expect(EvalLineRange.safeParse({ start: 5, end: 5 }).success).toBe(true);
  });
});

describe('eval case bodies', () => {
  const expectation = { must_find: [mustFind] };

  it('accepts a pasted diff', () => {
    const r = CreateEvalCaseBody.safeParse({ name: 'npe', source: { kind: 'paste', diff: '--- a\n+++ b\n' }, expectation });
    expect(r.success).toBe(true);
  });

  it('accepts a PR source and requires at least one file', () => {
    const pr_id = '00000000-0000-4000-8000-000000000001';
    expect(CreateEvalCaseBody.safeParse({ name: 'x', source: { kind: 'pr', pr_id, files: ['a.ts'] }, expectation }).success).toBe(true);
    expect(CreateEvalCaseBody.safeParse({ name: 'x', source: { kind: 'pr', pr_id, files: [] }, expectation }).success).toBe(false);
  });

  it('rejects an unknown source kind', () => {
    expect(CreateEvalCaseBody.safeParse({ name: 'x', source: { kind: 'url', url: 'http://x' }, expectation }).success).toBe(false);
  });

  it('update is partial but strict', () => {
    expect(UpdateEvalCaseBody.safeParse({ name: 'renamed' }).success).toBe(true);
    expect(UpdateEvalCaseBody.safeParse({ owner_id: 'x' }).success).toBe(false);
  });
});

describe('versions / stats / suites', () => {
  it('RestoreSkillVersionBody requires a positive int expected_version', () => {
    expect(RestoreSkillVersionBody.safeParse({ expected_version: 3 }).success).toBe(true);
    expect(RestoreSkillVersionBody.safeParse({ expected_version: 0 }).success).toBe(false);
    expect(RestoreSkillVersionBody.safeParse({}).success).toBe(false);
  });

  it('UpdateSkillBody accepts change_note and caps its length', () => {
    expect(UpdateSkillBody.safeParse({ body: 'x', change_note: 'tighten rule' }).success).toBe(true);
    expect(UpdateSkillBody.safeParse({ change_note: 'x'.repeat(501) }).success).toBe(false);
  });

  it('SkillStatsQuery: enum only, default 30d', () => {
    expect(SkillStatsQuery.parse({}).window).toBe('30d');
    expect(SkillStatsQuery.safeParse({ window: '1y' }).success).toBe(false);
  });

  it('CreateEvalSuiteBody requires a uuid carrier and a known mode', () => {
    const carrier_agent_id = '00000000-0000-4000-8000-000000000002';
    expect(CreateEvalSuiteBody.safeParse({ carrier_agent_id, mode: 'full' }).success).toBe(true);
    expect(CreateEvalSuiteBody.safeParse({ carrier_agent_id, mode: 'deep' }).success).toBe(false);
    expect(CreateEvalSuiteBody.safeParse({ carrier_agent_id: 'nope', mode: 'quick' }).success).toBe(false);
  });

  it('CreateEvalSuiteBody accepts an optional non-empty list of uuid case_ids', () => {
    const carrier_agent_id = '11111111-1111-4111-8111-111111111111';
    const id = '22222222-2222-4222-8222-222222222222';
    expect(CreateEvalSuiteBody.safeParse({ carrier_agent_id, mode: 'quick', case_ids: [id] }).success).toBe(true);
    expect(CreateEvalSuiteBody.safeParse({ carrier_agent_id, mode: 'quick', case_ids: [] }).success).toBe(false);
    expect(CreateEvalSuiteBody.safeParse({ carrier_agent_id, mode: 'quick', case_ids: ['nope'] }).success).toBe(false);
  });

  it('EvalCaseLatestResult: null medians (nothing scored) parse; a missing errored count does not', () => {
    const row = {
      case_id: 'c', suite_id: 's', suite_partial: true, suite_created_at: '2026-09-29T10:00:00.000Z', outcome: 'error',
      with: { passed: 0, total: 1 }, without: { passed: 1, total: 1 },
      expected_count: 1, matched_median: null, unexpected_median: null, is_clean: false, with_errored: 1, stale: false,
    };
    expect(EvalCaseLatestResult.safeParse(row).success).toBe(true);
    const { with_errored: _omit, ...missing } = row;
    expect(EvalCaseLatestResult.safeParse(missing).success).toBe(false);
  });

  it('EvalCaseDetailQuery: suite_id is an optional uuid', () => {
    expect(EvalCaseDetailQuery.safeParse({}).success).toBe(true);
    expect(EvalCaseDetailQuery.safeParse({ suite_id: 'x' }).success).toBe(false);
  });

  it('EvalCaseDetail parses a never-run case (suite null, empty arms)', () => {
    const empty = { passed: 0, total: 0, matched_median: null, unexpected_median: null, runs: [] };
    const r = EvalCaseDetail.safeParse({
      case: {
        id: 'c', skill_id: 's', name: 'n', notes: null, expectation: null, input_source: null, input_files: [],
        input_diff_preview: '', input_diff_chars: 0, input_diff_truncated: false, created_at: 'x', updated_at: 'y',
      },
      suite: null,
      arms: { with: empty, without: empty },
      outcome: null,
      expectation_changed: false,
      history: [],
    });
    expect(r.success).toBe(true);
  });

  it('SkillListItem stays backward compatible without the new card fields', () => {
    const base = {
      id: 's1', name: 'x', description: '', type: 'custom', source: 'manual', body: 'b',
      enabled: true, version: 1, agent_count: 0,
    };
    expect(SkillListItem.safeParse(base).success).toBe(true);
    const r = SkillListItem.parse({ ...base, runs_30d: 4, latest_verdict: { verdict: 'helps', carrier_name: 'A', stale: false } });
    expect(r.latest_verdict?.verdict).toBe('helps');
  });
});
