/**
 * Characterization (server spec 07, H1-H2): the `repoIntel` / `repoClone`
 * container getters are memoized and return a test override as-is. No DB: the
 * Container constructor does no I/O and both services only bind `db` lazily.
 */
import { describe, expect, it } from 'vitest';
import { Container, type ContainerOverrides } from '../src/platform/container.js';
import type { AppConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { RepoCloneFacade } from '../src/modules/repos/types.js';

const build = (overrides: ContainerOverrides = {}) =>
  new Container({ secretsPath: '/nonexistent', repoIntelEnabled: true } as AppConfig, {} as Db, overrides);

describe('container repo service getters', () => {
  it('H1: without overrides, repoIntel and repoClone are memoized', () => {
    const c = build();
    expect(c.repoIntel).toBe(c.repoIntel);
    expect(c.repoClone).toBe(c.repoClone);
  });

  it('H2: an override is returned as-is', () => {
    const fakeA = { getIndexState: async () => null } as unknown as RepoIntel;
    const fakeB = { getCloneStatus: async () => undefined } as unknown as RepoCloneFacade;
    const c = build({ repoIntel: fakeA, repoClone: fakeB });
    expect(c.repoIntel).toBe(fakeA);
    expect(c.repoClone).toBe(fakeB);
  });
});
