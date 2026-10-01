import { describe, it, expect } from 'vitest';
import { Octokit } from 'octokit';
import { OctokitGitHubClient } from '../src/adapters/github/octokit.js';

const API = 'https://api.github.com/repos/o/r/pulls/7';

/** Real Octokit (so `paginate` follows real Link headers) over a fake fetch. */
function clientWith(totalFiles: number, totalCommits: number) {
  const calls: string[] = [];
  const page = (kind: 'files' | 'commits', total: number, url: URL) => {
    const p = Number(url.searchParams.get('page') ?? '1');
    const per = Number(url.searchParams.get('per_page') ?? '30');
    const from = (p - 1) * per;
    const items = Array.from({ length: Math.max(0, Math.min(per, total - from)) }, (_, i) =>
      kind === 'files'
        ? { filename: `src/f${from + i}.ts`, additions: 1, deletions: 0, patch: '@@' }
        : {
            sha: `sha${from + i}`,
            commit: { message: 'm', author: { name: 'a', date: null } },
            author: null,
          },
    );
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (from + per < total) {
      headers.link = `<${API}/${kind}?per_page=${per}&page=${p + 1}>; rel="next"`;
    }
    return new Response(JSON.stringify(items), { status: 200, headers });
  };
  const fetch = async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/files')) return page('files', totalFiles, url);
    if (url.pathname.endsWith('/commits')) return page('commits', totalCommits, url);
    const pr = {
      number: 7,
      title: 't',
      user: { login: 'u' },
      head: { ref: 'h', sha: 'abc' },
      base: { ref: 'main' },
      additions: totalFiles,
      deletions: 0,
      changed_files: totalFiles,
      state: 'open',
      merged_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      body: null,
    };
    return new Response(JSON.stringify(pr), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = new OctokitGitHubClient('token');
  (client as unknown as { octokit: Octokit }).octokit = new Octokit({ request: { fetch } });
  return { client, calls };
}

describe('OctokitGitHubClient.getPullRequest pagination', () => {
  it('returns every file and commit of a PR larger than one 100-item page', async () => {
    const { client, calls } = clientWith(147, 230);
    const detail = await client.getPullRequest({ owner: 'o', name: 'r' }, 7);
    expect(detail.files_count).toBe(147);
    expect(detail.files).toHaveLength(147);
    expect(detail.files[146]?.path).toBe('src/f146.ts');
    expect(detail.commits).toHaveLength(230);
    expect(calls.filter((c) => c.includes('/files'))).toHaveLength(2);
    expect(calls.filter((c) => c.includes('/commits'))).toHaveLength(3);
  });

  it('makes a single request per list when everything fits in one page', async () => {
    const { client, calls } = clientWith(3, 1);
    const detail = await client.getPullRequest({ owner: 'o', name: 'r' }, 7);
    expect(detail.files).toHaveLength(3);
    expect(calls.filter((c) => c.includes('/files'))).toHaveLength(1);
  });
});
