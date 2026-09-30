import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
  ConventionCandidate,
  ConventionsPage,
  ConventionScan,
  UpdateConventionBody,
  CreateSkillFromConventionsBody,
  CreateSkillFromConventionsResponse,
  FEATURE_MODELS,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });

  it('RunTrace regression: an OLD trace with no cost fields at all still parses (.nullish(), not .nullable())', () => {
    // Pre-Cost-Badge jsonb documents in run_traces.trace don't have the key at
    // all — not `null`, absent. .nullable() would reject this; .nullish() must not.
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', model: 'gpt-4.1', source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [],
      raw_output: '{}',
      memory_pulled: [],
      specs_read: [],
      log: [],
    });
    expect(trace.stats.cost_usd).toBeUndefined();
    expect(trace.stats.cost_source).toBeUndefined();
  });

  it('RunTrace with cost fields (provider-sourced)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', model: 'gpt-4.1', source: 'local' },
      stats: {
        duration_ms: 8200,
        tokens_in: 14820,
        tokens_out: 1240,
        findings: 1,
        grounding: '1/1 passed',
        cost_usd: 0.0412,
        cost_source: 'provider',
      },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [],
      raw_output: '{}',
      memory_pulled: [],
      specs_read: [],
      log: [],
    });
    expect(trace.stats.cost_usd).toBeCloseTo(0.0412, 5);
    expect(trace.stats.cost_source).toBe('provider');
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});

describe('conventions contracts', () => {
  const scan = {
    id: 's1',
    repo_id: 'r1',
    status: 'done',
    commit_sha: 'abc123',
    error: null,
    sample_file_count: 12,
    found_count: 8,
    verified_count: 6,
    dropped_count: 2,
    relocated_count: 1,
    matched_prior_count: 3,
    duplicate_count: 0,
    retry_count: 0,
    model: 'deepseek/deepseek-v4-flash',
    tokens_in: 9000,
    tokens_out: 1200,
    cost_usd: 0.004,
    cost_source: 'estimated',
    started_at: '2026-09-29T10:00:00.000Z',
    finished_at: '2026-09-29T10:00:40.000Z',
    duration_ms: 40000,
  };
  const candidate = {
    id: 'c1',
    repo_id: 'r1',
    status: 'pending',
    category: 'error-handling',
    origin: 'code',
    rule: 'Throw typed AppError subclasses instead of bare Error.',
    original_rule: 'Throw typed AppError subclasses instead of bare Error.',
    edited: false,
    evidence: [{ path: 'src/a.ts', line_start: 3, line_end: 5, snippet: 'throw new NotFoundError()' }],
    support_count: 4,
    counter_count: 0,
    review_hits: 1,
    confidence: 0.82,
    seen_in_latest: true,
    last_seen_commit_sha: 'abc123',
    skills: [{ id: 'sk1', name: 'team-conventions' }],
    created_at: '2026-09-29T10:00:40.000Z',
  };

  it('ConventionsPage round-trips scan + candidate', () => {
    expect(ConventionScan.parse(scan).cost_source).toBe('estimated');
    const page = ConventionsPage.parse({
      last_scan: scan,
      running_scan: null,
      latest_done_scan: scan,
      candidates: [candidate],
    });
    expect(page.candidates[0]?.evidence).toHaveLength(1);
  });

  it('ConventionCandidate rejects the legacy shape and unknown enums', () => {
    expect(() =>
      ConventionCandidate.parse({
        id: 'c1',
        rule: 'r',
        evidence_path: 'a.ts',
        evidence_snippet: 's',
        confidence: 0.5,
        accepted: false,
      }),
    ).toThrow();
    expect(() => ConventionCandidate.parse({ ...candidate, category: 'style' })).toThrow();
    expect(() => ConventionCandidate.parse({ ...candidate, status: 'done' })).toThrow();
    expect(() => ConventionCandidate.parse({ ...candidate, confidence: 1.2 })).toThrow();
  });

  it('UpdateConventionBody rejects an empty body and unknown fields', () => {
    expect(UpdateConventionBody.safeParse({}).success).toBe(false);
    expect(UpdateConventionBody.safeParse({ status: 'accepted', extra: 1 }).success).toBe(false);
    expect(UpdateConventionBody.safeParse({ rule: 'short' }).success).toBe(false);
    expect(UpdateConventionBody.safeParse({ rule: 'x'.repeat(301) }).success).toBe(false);
    expect(UpdateConventionBody.safeParse({ category: 'other' }).success).toBe(true);
    expect(UpdateConventionBody.safeParse({ status: 'rejected', rule: 'x'.repeat(8) }).success).toBe(true);
  });

  it('CreateSkillFromConventionsBody enforces id list bounds', () => {
    const ok = { name: 'n', body: 'b', enabled: true, convention_ids: ['c1'], agent_ids: [] };
    expect(CreateSkillFromConventionsBody.safeParse(ok).success).toBe(true);
    expect(CreateSkillFromConventionsBody.safeParse({ ...ok, convention_ids: [] }).success).toBe(false);
    expect(
      CreateSkillFromConventionsBody.safeParse({
        ...ok,
        convention_ids: Array.from({ length: 51 }, (_, i) => `c${i}`),
      }).success,
    ).toBe(false);
    expect(
      CreateSkillFromConventionsBody.safeParse({
        ...ok,
        agent_ids: Array.from({ length: 21 }, (_, i) => `a${i}`),
      }).success,
    ).toBe(false);
  });

  it('CreateSkillFromConventionsResponse embeds the Skill schema', () => {
    const skill = {
      id: 'sk1',
      name: 'team-conventions',
      description: 'd',
      type: 'convention',
      source: 'extracted',
      body: 'b',
      enabled: true,
      version: 1,
    };
    expect(
      CreateSkillFromConventionsResponse.parse({ skill, linked_agent_ids: ['a1'] }).skill.source,
    ).toBe('extracted');
  });

  it('FEATURE_MODELS conventions defaults to openrouter deepseek', () => {
    const m = FEATURE_MODELS.find((f) => f.id === 'conventions');
    expect(m?.defaultProvider).toBe('openrouter');
    expect(m?.defaultModel).toBe('deepseek/deepseek-v4-flash');
  });
});
