/**
 * Pure brief rules: link classification (D6), confidence (D7), the
 * `automatic_brief` default. No I/O.
 */
import { describe, it, expect } from 'vitest';
import {
  capConfidence,
  confidenceCap,
  isSafeRelativePath,
  meaningfulLength,
  planLinks,
  resolveAutomaticBrief,
} from '../src/modules/brief/domain.js';

const REPO = { owner: 'acme', name: 'api' };
const plan = (body: string) => planLinks(body, REPO);

describe('planLinks (D6)', () => {
  it('classifies a relative doc path, stripping a leading ./', () => {
    expect(plan('See docs/design.md and ./docs/plan.md').docs.map((d) => d.path)).toEqual([
      'docs/design.md',
      'docs/plan.md',
    ]);
  });

  it('reads a same-repo blob link as a doc and keeps the ref it named (case-insensitive repo)', () => {
    const p = plan('https://github.com/Acme/API/blob/release-1/docs/spec.md');
    expect(p.docs).toEqual([{ path: 'docs/spec.md', urlRef: 'release-1' }]);
    expect(p.unresolved).toEqual([]);
  });

  it('records other-repo, external-host and non-doc links as unresolved, never as docs', () => {
    const p = plan(
      [
        'https://github.com/other/repo/blob/main/a.md',
        'https://acme.atlassian.net/browse/ABC-1',
        'https://github.com/acme/api/blob/main/src/index.ts',
      ].join('\n'),
    );
    expect(p.docs).toEqual([]);
    expect(p.unresolved).toEqual([
      { url: 'https://github.com/other/repo/blob/main/a.md', reason: 'other_repo' },
      { url: 'https://acme.atlassian.net/browse/ABC-1', reason: 'external_host' },
      { url: 'https://github.com/acme/api/blob/main/src/index.ts', reason: 'not_a_doc' },
    ]);
  });

  it('drops the query string and fragment of a stored URL (may carry tokens)', () => {
    const p = plan('https://tracker.example.com/t/1?token=SECRET#frag');
    expect(p.unresolved).toEqual([{ url: 'https://tracker.example.com/t/1', reason: 'external_host' }]);
    expect(JSON.stringify(p)).not.toContain('SECRET');
  });

  it('takes only a closing keyword as an issue link; a bare #12 is ignored', () => {
    expect(plan('relates to #12').issues).toEqual([]);
    expect(plan('closes #12').issues).toEqual([12]);
    expect(plan('Fixes #7, see also https://github.com/acme/api/issues/9').issues).toEqual([7]);
    expect(plan('https://github.com/acme/api/issues/9').issues).toEqual([9]);
  });

  it.each([
    ['parent traversal', 'read ../secret.md now'],
    ['absolute path', 'read /etc/passwd.md now'],
    ['leading dash (git option)', 'read -x.md now'],
    ['NUL byte', 'read a\0b.md now'],
  ])('never lets an unsafe path (%s) become a doc', (_name, body) => {
    const p = plan(body);
    expect(p.docs).toEqual([]);
    expect(p.unresolved.every((u) => u.reason === 'unsafe_path')).toBe(true);
    expect(p.unresolved.length).toBeGreaterThan(0);
  });

  it('never reads a doc out of an encoded-traversal blob link (URL parser collapses it, so it is not a blob doc)', () => {
    const p = plan('https://github.com/acme/api/blob/main/%2E%2E/%2E%2E/etc/x.md');
    expect(p.docs).toEqual([]);
    expect(p.unresolved).toHaveLength(1);
  });

  it('keeps the first 3 docs and records the rest as limit_reached; 2nd issue too', () => {
    const p = plan('a.md b.md c.md d.md e.md closes #1 fixes #2');
    expect(p.docs.map((d) => d.path)).toEqual(['a.md', 'b.md', 'c.md']);
    expect(p.issues).toEqual([1]);
    expect(p.unresolved).toEqual([
      { url: 'd.md', reason: 'limit_reached' },
      { url: 'e.md', reason: 'limit_reached' },
      { url: '#2', reason: 'limit_reached' },
    ]);
  });

  it('deduplicates the same doc mentioned twice', () => {
    expect(plan('docs/a.md then docs/a.md').docs).toHaveLength(1);
  });

  it('SEC-1: a 64 KiB run of "#" is scanned in under 500 ms', () => {
    const t0 = performance.now();
    const p = plan('#'.repeat(65536));
    expect(performance.now() - t0).toBeLessThan(500);
    expect(p).toEqual({ docs: [], issues: [], unresolved: [] });
  });

  it('SEC-1: a path token longer than 300 characters is not recognized (no backtracking blowup)', () => {
    const t0 = performance.now();
    const flat = plan(`${'a'.repeat(301)}.md`);
    const nested = plan(`${'ab/'.repeat(120)}x.md`); // ~363 chars
    expect(performance.now() - t0).toBeLessThan(500);
    expect(flat.docs).toEqual([]);
    expect(nested.docs).toEqual([]);
    // the bound is on length, not a blanket ban: 300 still matches
    expect(plan(`${'a'.repeat(297)}.md`).docs).toHaveLength(1);
  });
});

describe('isSafeRelativePath', () => {
  it.each([
    ['docs/a.md', true],
    ['', false],
    ['/abs.md', false],
    ['-x.md', false],
    ['a/../b.md', false],
    ['a\0.md', false],
    ['a..b/c.md', true],
  ])('%j -> %s', (p, ok) => {
    expect(isSafeRelativePath(p)).toBe(ok);
  });
});

describe('confidence cap (D7)', () => {
  const sig = (over: Partial<Parameters<typeof confidenceCap>[0]> = {}) => ({
    descriptionChars: 0,
    hasResolvedDoc: false,
    hasIssueBody: false,
    unresolved: [],
    ...over,
  });

  it.each([
    [sig({ descriptionChars: 0 }), 'low'],
    [sig({ descriptionChars: 39 }), 'low'],
    [sig({ descriptionChars: 40 }), 'medium'],
    [sig({ descriptionChars: 199 }), 'medium'],
    [sig({ descriptionChars: 200 }), 'high'],
    [sig({ hasResolvedDoc: true }), 'high'],
    [sig({ hasIssueBody: true }), 'high'],
  ] as const)('signals %# -> %s', (s, expected) => {
    expect(confidenceCap(s)).toBe(expected);
  });

  it('an unresolved spec-like link lowers high to medium but never raises low', () => {
    const unresolved = [{ url: 'https://wiki.example.com/design-doc', reason: 'external_host' as const }];
    expect(confidenceCap(sig({ descriptionChars: 500, unresolved }))).toBe('medium');
    expect(confidenceCap(sig({ descriptionChars: 5, unresolved }))).toBe('low');
    const plain = [{ url: 'https://example.com/x', reason: 'external_host' as const }];
    expect(confidenceCap(sig({ descriptionChars: 500, unresolved: plain }))).toBe('high');
  });

  it('capConfidence is min(model, cap)', () => {
    expect(capConfidence('high', 'medium')).toBe('medium');
    expect(capConfidence('low', 'high')).toBe('low');
    expect(capConfidence('medium', 'medium')).toBe('medium');
  });

  it('a template-only body counts as no description', () => {
    const body = '<!-- describe -->\n## Summary\n- [ ] tests\n- [x] docs\n';
    expect(meaningfulLength(body)).toBe(0);
    expect(meaningfulLength(null)).toBe(0);
    expect(meaningfulLength('real   text\n\nhere')).toBe('real text here'.length);
  });
});

describe('resolveAutomaticBrief', () => {
  it('missing row -> ON, explicit false -> OFF, true -> ON', () => {
    expect(resolveAutomaticBrief(undefined)).toBe(true);
    expect(resolveAutomaticBrief(false)).toBe(false);
    expect(resolveAutomaticBrief(true)).toBe(true);
  });

  it('only an explicit boolean false turns it off (a junk stored value does not)', () => {
    expect(resolveAutomaticBrief(null)).toBe(true);
    expect(resolveAutomaticBrief('false')).toBe(true);
    expect(resolveAutomaticBrief(0)).toBe(true);
  });
});
