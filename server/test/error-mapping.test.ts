import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { ConfigError, NoJobHandlerError } from '../src/platform/errors.js';
import { JobRunner, redactCredentials } from '../src/platform/jobs.js';
import { RepoService } from '../src/modules/repos/service.js';
import type { Container } from '../src/platform/container.js';
import type { RepoRepository } from '../src/modules/repos/repository.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

async function appThrowing(err: unknown) {
  const app = await buildApp({ config });
  app.get('/__boom', async () => {
    throw err;
  });
  return app;
}

describe('error handler status mapping (no DB)', () => {
  it('Octokit-style error with .status=404 and no statusCode -> 404', async () => {
    const app = await appThrowing(Object.assign(new Error('Not Found'), { status: 404 }));
    const res = await app.inject({ method: 'GET', url: '/__boom' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('internal_error');
    await app.close();
  });

  it('out-of-range .status falls back to 500', async () => {
    const app = await appThrowing(Object.assign(new Error('x'), { status: 200 }));
    const res = await app.inject({ method: 'GET', url: '/__boom' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('ConfigError -> 424 with code config_error', async () => {
    const app = await appThrowing(new ConfigError('GITHUB_TOKEN is not configured'));
    const res = await app.inject({ method: 'GET', url: '/__boom' });
    expect(res.statusCode).toBe(424);
    expect(res.json().error.code).toBe('config_error');
    await app.close();
  });
});

describe('RepoService.requestClone enqueue errors', () => {
  const repoRow = { id: 'r1', owner: 'acme', name: 'x', fullName: 'acme/x' };
  const make = (enqueue: () => Promise<never>) => {
    const container = {
      jobs: { enqueue },
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    } as unknown as Container;
    const repo = { getById: async () => repoRow } as unknown as RepoRepository;
    return new RepoService(container, repo);
  };

  it('missing handler -> no_handler', async () => {
    const s = make(async () => {
      throw new NoJobHandlerError('repo.clone');
    });
    expect(await s.requestClone('w1', 'r1')).toEqual({ queued: false, reason: 'no_handler' });
  });

  it('any other enqueue error propagates', async () => {
    const s = make(async () => {
      throw new Error('connection terminated');
    });
    await expect(s.requestClone('w1', 'r1')).rejects.toThrow('connection terminated');
  });

  it('JobRunner throws NoJobHandlerError for an unregistered kind', async () => {
    const jobs = new JobRunner({} as never);
    await expect(jobs.enqueue('w1', 'nope', {})).rejects.toBeInstanceOf(NoJobHandlerError);
  });
});

describe('redactCredentials', () => {
  it('masks API keys and bearer tokens', () => {
    const out = redactCredentials('401 sk-or-v1-abcdef0123456789 and Authorization: Bearer xyz.abc-123');
    expect(out).not.toContain('abcdef0123456789');
    expect(out).not.toContain('xyz.abc-123');
    expect(out).toContain('sk-***');
    expect(out).toContain('Bearer ***');
  });
});
