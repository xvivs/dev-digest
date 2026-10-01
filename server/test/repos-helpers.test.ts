/** AR-1 / AR-2: pure repos helpers. */
import { describe, it, expect } from 'vitest';
import { classifyCloneFailure, cloneUrlFor, withGitHubToken } from '../src/modules/repos/helpers.js';
import { GITHUB_HTTPS_HOST } from '../src/modules/repos/constants.js';

describe('cloneUrlFor', () => {
  it('builds the public https URL from the shared host constant', () => {
    expect(cloneUrlFor('acme/app')).toBe('https://github.com/acme/app.git');
    expect(new URL(cloneUrlFor('acme/app')).hostname).toBe(GITHUB_HTTPS_HOST);
  });

  it('is accepted by withGitHubToken (token is embedded only for the GitHub host)', () => {
    expect(withGitHubToken(cloneUrlFor('acme/app'), 'tok')).toBe('https://x-access-token:tok@github.com/acme/app.git');
  });
});

describe('classifyCloneFailure', () => {
  it.each([
    ["fatal: repository 'https://github.com/acme/app.git/' not found", 'not_found'],
    ['remote: Repository not found.\nfatal: repository ... not found', 'not_found'],
    ["fatal: unable to access 'https://github.com/a/b.git/': The requested URL returned error: 404", 'not_found'],
    ["fatal: Authentication failed for 'https://github.com/acme/app.git/'", 'auth'],
    ['fatal: could not read Username for https://github.com: terminal prompts disabled', 'auth'],
    ["fatal: unable to access 'https://github.com/a/b.git/': The requested URL returned error: 403", 'auth'],
    ["fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com", 'network'],
    ['fatal: the remote end hung up unexpectedly: early EOF', 'network'],
    ['spawn git ENOENT', 'unknown'],
    ['boom', 'unknown'],
  ])('%s -> %s', (message, reason) => {
    expect(classifyCloneFailure(new Error(message))).toBe(reason);
  });

  it('accepts non-Error throws and returns only the class (no URL, no token)', () => {
    expect(classifyCloneFailure('https://x-access-token:ghp_SECRET@github.com/a/b.git')).toBe('unknown');
    expect(classifyCloneFailure(undefined)).toBe('unknown');
  });
});
