import { describe, it, expect } from 'vitest';
import { SKILL_NAME_PATTERN } from '../_shared/skill-rules.js';
import {
  computeConfidence,
  defaultConventionsSkillName,
  dirKey,
  fingerprint,
  maxFencedBlockLines,
  normalizeEvidencePath,
  normalizeRule,
  packSample,
  planConventionUpdate,
  relocateQuote,
  renderSampleFile,
  resolveAndMerge,
  slugifySkillName,
  sortCandidates,
  stratifySample,
  stripGutter,
  verifyCandidates,
  InvalidConventionRuleError,
  type ConventionRecord,
  type ProposedCandidate,
  type ScanSignal,
  type VerifiedCandidate,
} from './domain.js';

const FILE_A = [
  "import { z } from 'zod';",
  '',
  'export async function loadUser(id: string): Promise<User> {',
  '  const row = await db.select().from(users).where(eq(users.id, id));',
  "  if (!row) throw new NotFoundError('User not found');",
  '  return toUser(row);',
  '}',
  '',
  'export async function loadTeam(id: string): Promise<Team> {',
  "  if (!id) throw new NotFoundError('Team not found');",
  '  return toTeam(await db.select().from(teams));',
  '}',
];
const FILE_B = ['export function x() {', "  throw new NotFoundError('X not found');", '}'];

function candidate(over: Partial<ProposedCandidate> = {}): ProposedCandidate {
  return {
    rule: 'Throw NotFoundError when a row is missing',
    evidence: [{ path: 'src/a.ts', quote: "if (!row) throw new NotFoundError('User not found');", line_hint: 5 }],
    counter_example: null,
    origin: 'code',
    signal_id: null,
    prior_ref: null,
    category: 'error-handling',
    llm_confidence: 0.8,
    ...over,
  };
}

const files = new Map<string, string[]>([
  ['src/a.ts', FILE_A],
  ['src/lib/b.ts', FILE_B],
]);
const noSignals = new Map<string, ScanSignal>();

describe('relocateQuote', () => {
  it('finds an exact quote and keeps the hinted line', () => {
    expect(relocateQuote(FILE_A, "if (!row) throw new NotFoundError('User not found');", 5)).toEqual({
      lineStart: 5,
      lineEnd: 5,
      relocated: false,
    });
  });

  it('relocates a quote with whitespace drift and corrects the lines', () => {
    const hit = relocateQuote(FILE_A, "const row = await db.select()\n.from(users).where(eq(users.id,id));", 40);
    expect(hit).toEqual({ lineStart: 4, lineEnd: 4, relocated: true });
  });

  it('marks a quote relocated when the hint is wrong', () => {
    expect(relocateQuote(FILE_A, 'return toUser(row);', 1)?.relocated).toBe(true);
  });

  it('drops a hallucinated quote', () => {
    expect(relocateQuote(FILE_A, 'throw new HttpError(404, "missing")', null)).toBeNull();
  });

  it('drops a quote with fewer than 8 non-whitespace characters', () => {
    expect(relocateQuote(FILE_A, '}', null)).toBeNull();
    expect(relocateQuote(FILE_A, 'import', null)).toBeNull();
  });

  it('picks the match nearest line_hint, else the first', () => {
    const lines = ['doThing(alpha);', 'x', 'doThing(alpha);', 'y', 'doThing(alpha);'];
    expect(relocateQuote(lines, 'doThing(alpha);', 4)?.lineStart).toBe(3);
    expect(relocateQuote(lines, 'doThing(alpha);', 5)?.lineStart).toBe(5);
    expect(relocateQuote(lines, 'doThing(alpha);', null)?.lineStart).toBe(1);
  });

  it('strips a gutter the model copied into the quote', () => {
    expect(stripGutter('   5| if (!row) x\n   6| return y')).toBe('if (!row) x\nreturn y');
    expect(stripGutter('a | b')).toBe('a | b');
    expect(relocateQuote(FILE_A, "   5| if (!row) throw new NotFoundError('User not found');", 5)?.lineStart).toBe(5);
  });
});

describe('normalizeEvidencePath', () => {
  const sent = ['src/a.ts', 'src/lib/b.ts', 'pkg/lib/b.ts', 'src/modules/c/index.ts'];
  it('strips ./ and :N / :N-M', () => {
    expect(normalizeEvidencePath('./src/a.ts:12', sent)).toBe('src/a.ts');
    expect(normalizeEvidencePath('src/a.ts:3-9', sent)).toBe('src/a.ts');
  });
  it('accepts a unique suffix and refuses an ambiguous one', () => {
    expect(normalizeEvidencePath('c/index.ts', sent)).toBe('src/modules/c/index.ts');
    expect(normalizeEvidencePath('lib/b.ts', sent)).toBeNull();
    expect(normalizeEvidencePath('b.ts', sent)).toBeNull();
  });
  it('refuses traversal, absolute paths and NUL', () => {
    expect(normalizeEvidencePath('../src/a.ts', sent)).toBeNull();
    expect(normalizeEvidencePath('/src/a.ts', sent)).toBeNull();
    expect(normalizeEvidencePath('src/a.ts\0', sent)).toBeNull();
  });
});

describe('stratifySample', () => {
  it('puts forced files first, caps 3 per directory group and round-robins by rank', () => {
    const ranked = [
      'src/modules/a.ts',
      'src/modules/b.ts',
      'src/modules/c.ts',
      'src/modules/d.ts',
      'src/lib/x.ts',
      'web/app/p.tsx',
      'src/lib/y.ts',
    ];
    const out = stratifySample(ranked, ['forced/f.ts'], 12, 3);
    expect(out[0]).toBe('forced/f.ts');
    expect(out.slice(1, 4)).toEqual(['src/modules/a.ts', 'src/lib/x.ts', 'web/app/p.tsx']);
    expect(out.filter((p) => dirKey(p) === 'src/modules')).toHaveLength(3);
    expect(out).not.toContain('src/modules/d.ts');
  });

  it('stops at the limit, forced files included', () => {
    const ranked = Array.from({ length: 30 }, (_, i) => `d${i}/f.ts`);
    const out = stratifySample(ranked, ['f1.ts', 'f2.ts'], 12);
    expect(out).toHaveLength(12);
    expect(out.slice(0, 2)).toEqual(['f1.ts', 'f2.ts']);
  });
});

describe('renderSampleFile / packSample', () => {
  it('renders a 1-based gutter and marks a truncated file', () => {
    const content = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join('\n');
    const f = renderSampleFile('a.ts', 'code', content, 3, 10_000);
    expect(f?.text.split('\n')[0]).toBe('   1| line 1');
    expect(f?.text.endsWith('… truncated at line 3')).toBe(true);
    expect(f?.lines).toHaveLength(3);
  });

  it('cuts at the byte limit and skips empty or binary files', () => {
    const f = renderSampleFile('a.ts', 'code', 'aaaa\nbbbb\ncccc', 200, 10);
    expect(f?.lines).toEqual(['aaaa', 'bbbb']);
    expect(renderSampleFile('e.ts', 'code', '\n  \n', 200, 100)).toBeNull();
    expect(renderSampleFile('b.bin', 'code', 'a\0b', 200, 100)).toBeNull();
  });

  it('files past the total budget are not in the sent set', () => {
    const mk = (p: string, n: number) => renderSampleFile(p, 'code', 'x'.repeat(n), 10, 10_000)!;
    const { sent, cut } = packSample([mk('a', 50), mk('b', 50), mk('c', 10)], 110);
    expect(sent.map((f) => f.path)).toEqual(['a', 'c']);
    expect(cut).toEqual(['b']);
  });
});

describe('computeConfidence', () => {
  it('applies the AC-16 formula', () => {
    expect(computeConfidence({ llm: 1, support: 3, signal: true, counter: false })).toBe(1);
    expect(computeConfidence({ llm: 0.5, support: 2, signal: false, counter: true })).toBeCloseTo(0.225 + 0.3 - 0.3, 3);
  });
  it('caps single-file support at 0.59', () => {
    expect(computeConfidence({ llm: 1, support: 1, signal: true, counter: false })).toBe(0.59);
  });
  it('clamps to [0, 1]', () => {
    expect(computeConfidence({ llm: 0, support: 1, signal: false, counter: true })).toBe(0);
  });
});

describe('fingerprint', () => {
  it('is stable across case, punctuation and whitespace', () => {
    expect(fingerprint('Use named exports.')).toBe(fingerprint('  use NAMED   exports '));
    expect(normalizeRule('Throw NotFoundError!')).toBe('throw notfounderror');
    expect(fingerprint('Use named exports')).not.toBe(fingerprint('Use default exports'));
  });
});

describe('verifyCandidates', () => {
  it('keeps real evidence with the real snippet, not the model text', () => {
    const r = verifyCandidates({
      candidates: [
        candidate({
          evidence: [
            { path: './src/a.ts:5', quote: "if (!row)   throw new NotFoundError('User not found');", line_hint: 5 },
            { path: 'lib/b.ts', quote: "throw new NotFoundError('X not found');", line_hint: 2 },
          ],
        }),
      ],
      files,
      signals: noSignals,
      priorRefs: new Set(),
    });
    expect(r.verified).toHaveLength(1);
    const v = r.verified[0]!;
    expect(v.evidence.map((e) => [e.path, e.lineStart])).toEqual([
      ['src/a.ts', 5],
      ['src/lib/b.ts', 2],
    ]);
    expect(v.evidence[0]!.snippet).toBe(FILE_A[4]);
    expect(v.support).toBe(2);
    expect(r.relocated).toBe(1);
  });

  it('drops a candidate whose only quote is hallucinated, or from a path outside the sample', () => {
    const r = verifyCandidates({
      candidates: [
        candidate({ evidence: [{ path: 'src/a.ts', quote: 'totally made up line of code', line_hint: null }] }),
        candidate({ evidence: [{ path: 'src/secret.ts', quote: "if (!row) throw new NotFoundError('User not found');", line_hint: 5 }] }),
      ],
      files,
      signals: noSignals,
      priorRefs: new Set(),
    });
    expect(r).toMatchObject({ found: 2, dropped: 2, verified: [] });
  });

  it('caps confidence for single-file support', () => {
    const r = verifyCandidates({ candidates: [candidate({ llm_confidence: 1 })], files, signals: noSignals, priorRefs: new Set() });
    expect(r.verified[0]!.confidence).toBeLessThanOrEqual(0.59);
  });

  it('drops a rule with invisible characters', () => {
    const r = verifyCandidates({
      candidates: [candidate({ rule: 'Throw NotFoundError​ when missing' })],
      files,
      signals: noSignals,
      priorRefs: new Set(),
    });
    expect(r.verified).toHaveLength(0);
  });

  it('validates signal_id and prior_ref against what was sent', () => {
    const signals = new Map<string, ScanSignal>([['S1', { id: 'S1', category: 'bug', title: 't', prCount: 3, files: [] }]]);
    const r = verifyCandidates({
      candidates: [
        candidate({ origin: 'review_history', signal_id: 'S1', prior_ref: 'P1' }),
        candidate({ rule: 'Another rule backed by evidence', origin: 'review_history', signal_id: 'S9', prior_ref: 'P7' }),
      ],
      files,
      signals,
      priorRefs: new Set(['P1']),
    });
    expect(r.verified[0]).toMatchObject({ signalId: 'S1', origin: 'review_history', reviewHits: 3, priorRef: 'P1' });
    expect(r.verified[1]).toMatchObject({ signalId: null, origin: 'code', reviewHits: 0, priorRef: null });
  });
});

describe('resolveAndMerge', () => {
  const v = (over: Partial<VerifiedCandidate>): VerifiedCandidate => ({
    rule: 'Throw NotFoundError when a row is missing',
    category: 'error-handling',
    origin: 'code',
    priorRef: null,
    signalId: null,
    llmConfidence: 0.8,
    evidence: [{ path: 'src/a.ts', lineStart: 5, lineEnd: 5, snippet: 's' }],
    support: 1,
    counter: false,
    reviewHits: 0,
    relocated: false,
    confidence: 0.5,
    ...over,
  });

  it('matches a validated prior_ref first, then the exact fingerprint, else new', () => {
    const fpIndex = new Map([[fingerprint('Use named exports'), 'id-fp']]);
    const r = resolveAndMerge(
      [v({ priorRef: 'P1', rule: 'Totally reworded rule text' }), v({ rule: 'use named exports!' }), v({ rule: 'Brand new rule here' })],
      new Map([['P1', 'id-prior']]),
      fpIndex,
    );
    expect(r.observations.map((o) => o.existingId)).toEqual(['id-prior', 'id-fp', null]);
    expect(r.matchedPriorCount).toBe(2);
  });

  it('merges two candidates resolving to one identity (G1)', () => {
    const r = resolveAndMerge(
      [
        v({ priorRef: 'P1', rule: 'Weak wording', confidence: 0.4 }),
        v({
          priorRef: 'P1',
          rule: 'Strong wording',
          confidence: 0.7,
          evidence: [
            { path: 'src/b.ts', lineStart: 1, lineEnd: 1, snippet: 'b' },
            { path: 'src/a.ts', lineStart: 5, lineEnd: 5, snippet: 's' },
          ],
        }),
      ],
      new Map([['P1', 'id-1']]),
      new Map(),
    );
    expect(r.observations).toHaveLength(1);
    expect(r.duplicateCount).toBe(1);
    const o = r.observations[0]!;
    expect(o.rule).toBe('Strong wording');
    expect(o.evidence.map((e) => e.path)).toEqual(['src/b.ts', 'src/a.ts']);
    expect(o.supportCount).toBe(2);
  });

  it('merges two new candidates with the same fingerprint', () => {
    const r = resolveAndMerge([v({ rule: 'Use named exports' }), v({ rule: 'use named exports.' })], new Map(), new Map());
    expect(r.observations).toHaveLength(1);
    expect(r.duplicateCount).toBe(1);
    expect(r.matchedPriorCount).toBe(0);
  });
});

describe('sortCandidates', () => {
  it('orders by status, then confidence desc, then created_at desc', () => {
    const mk = (id: string, status: 'pending' | 'accepted' | 'rejected', confidence: number, created: number) => ({
      id,
      status,
      observation: { evidence: [], supportCount: 1, counterCount: 0, reviewHits: 0, confidence },
      createdAt: new Date(created),
    });
    const out = sortCandidates([
      mk('r', 'rejected', 0.9, 1),
      mk('a', 'accepted', 0.5, 1),
      mk('p-old', 'pending', 0.5, 1),
      mk('p-new', 'pending', 0.5, 2),
      mk('p-hi', 'pending', 0.9, 0),
    ]);
    expect(out.map((c) => c.id)).toEqual(['p-hi', 'p-new', 'p-old', 'a', 'r']);
  });
});

describe('planConventionUpdate', () => {
  const current: ConventionRecord = {
    id: 'c',
    workspaceId: 'w',
    repoId: 'r',
    fingerprint: 'fp',
    category: 'naming',
    origin: 'code',
    rule: 'Use camelCase names',
    originalRule: 'Use camelCase names',
    status: 'pending',
    editedAt: null,
    decidedAt: null,
    createdAt: new Date(0),
    lastSeenScanId: null,
  };
  const now = new Date(1000);

  it('stamps edited_at on a rule/category change and decided_at on a status change', () => {
    expect(planConventionUpdate(current, { rule: '  Use camelCase for vars  ', status: 'accepted' }, now)).toEqual({
      rule: 'Use camelCase for vars',
      editedAt: now,
      status: 'accepted',
      decidedAt: now,
    });
    expect(planConventionUpdate({ ...current, status: 'accepted' }, { status: 'pending' }, now)).toEqual({
      status: 'pending',
      decidedAt: null,
    });
    expect(planConventionUpdate(current, { rule: 'Use camelCase names' }, now)).toEqual({});
  });

  it('rejects an empty rule or invisible characters (422)', () => {
    expect(() => planConventionUpdate(current, { rule: '        ' }, now)).toThrow(InvalidConventionRuleError);
    expect(() => planConventionUpdate(current, { rule: 'Use camel‮Case names' }, now)).toThrow(InvalidConventionRuleError);
  });
});

describe('skill body helpers', () => {
  it('measures fenced blocks, honouring longer fences', () => {
    const body = ['# Rule', '````ts', 'a', '```', 'b', '````', 'text', '~~~', '1', '2', '~~~'].join('\n');
    expect(maxFencedBlockLines(body)).toBe(3);
  });

  it('slugifies repo names into valid skill names', () => {
    for (const raw of ['Acme/Payments_API', 'x', '---', 'Ünïcödé Repo!!', 'a'.repeat(100)]) {
      const name = defaultConventionsSkillName(raw);
      expect(name).toMatch(SKILL_NAME_PATTERN);
      expect(name.endsWith('-conventions')).toBe(true);
    }
    expect(slugifySkillName('Payments_API')).toBe('payments-api');
  });
});
