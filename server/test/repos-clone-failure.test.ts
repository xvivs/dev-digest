/**
 * A failing `git clone` (seeded fake repo `acme/payments-api` does not exist on
 * GitHub) must not become an unhandled rejection: `RepoService.add/refresh`
 * enqueue the clone and never read `EnqueuedJob.done`, so JobRunner itself has
 * to observe the failure, log it (no credentials) and persist it on the job row.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { JobRunner, redactCredentials } from '../src/platform/jobs.js';
import { RepoService } from '../src/modules/repos/service.js';
import { MockGitClient } from '../src/adapters/mocks.js';
import type { Container } from '../src/platform/container.js';
import type { RepoRepository } from '../src/modules/repos/repository.js';

/** In-memory stand-in for the two drizzle chains JobRunner uses. */
function fakeDb() {
  const updates: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({ values: () => ({ returning: async () => [{ id: 'job-1' }] }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return { where: async () => undefined };
      },
    }),
  };
  return { db, updates };
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  unhandled.length = 0;
});

describe('clone failure handling', () => {
  it('RepoService.add: rejected clone is logged, recorded on the job, and never unhandled', async () => {
    process.on('unhandledRejection', onUnhandled);
    const { db, updates } = fakeDb();
    const jobs = new JobRunner(db as never, { retries: 0 });
    const warn = vi.fn();
    jobs.logger = { warn };

    const git = new MockGitClient();
    git.clone = async () => {
      throw new Error(
        "Cloning into 'x'...\nfatal: repository 'https://x-access-token:ghp_SECRET@github.com/acme/payments-api.git/' not found",
      );
    };
    const container = {
      db,
      jobs,
      git,
      secrets: { get: async () => 'ghp_SECRET' },
    } as unknown as Container;

    const service = new RepoService(container);
    (service as unknown as { repo: Partial<RepoRepository> }).repo = {
      findByFullName: async () => undefined,
      insert: async () => ({ id: 'r1', workspaceId: 'w1', owner: 'acme', name: 'payments-api', fullName: 'acme/payments-api', defaultBranch: 'main', clonePath: null, lastPolledAt: null, createdBy: 'u1' }),
    } as never;
    service.registerCloneJobHandler();

    const res = await service.add('w1', 'u1', 'https://github.com/acme/payments-api');
    expect(res.created).toBe(true);

    await jobs.onIdle();
    await new Promise((r) => setImmediate(r)); // let Node run its unhandled-rejection pass

    expect(unhandled).toEqual([]);
    const failed = updates.find((u) => u.status === 'failed');
    expect(failed).toBeDefined();
    expect(String(failed!.error)).toContain('not found');
    expect(String(failed!.error)).not.toContain('ghp_SECRET');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('ghp_SECRET');
  });

  it('done still rejects for callers that await it', async () => {
    const { db } = fakeDb();
    const jobs = new JobRunner(db as never, { retries: 0 });
    jobs.register('boom', async () => {
      throw new Error('nope');
    });
    const job = await jobs.enqueue('w1', 'boom', {});
    await expect(job.done).rejects.toThrow('nope');
  });

  it('redactCredentials strips user:password from URLs', () => {
    expect(redactCredentials('fatal: https://u:tok@github.com/a/b.git')).toBe('fatal: https://***@github.com/a/b.git');
  });
});
