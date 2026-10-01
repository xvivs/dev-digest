import type { SmartDiffRole } from '@devdigest/shared';

/** Display order of the Smart Diff groups. */
export const ROLE_ORDER: readonly SmartDiffRole[] = [
  'core',
  'tests',
  'wiring',
  'docs',
  'boilerplate',
];

/** Matching order, first match wins; a path that matches none is `core`. */
export const CLASSIFY_ORDER: readonly Exclude<SmartDiffRole, 'core'>[] = [
  'boilerplate',
  'tests',
  'wiring',
  'docs',
];

/** classifyFile returns `core` without running a pattern on a longer path. */
export const MAX_PATH_LENGTH = 1024;
/** ...or on a path with a longer segment (`[^/]*` patterns are quadratic in it). */
export const MAX_SEGMENT_LENGTH = 255;

/**
 * Patterns per role. Every regex is anchored and has no nested quantifiers or
 * backreferences, but `[^/]*` followed by a literal is quadratic in segment
 * length: paths come from PR authors, so classifyFile length-guards first
 * (MAX_PATH_LENGTH / MAX_SEGMENT_LENGTH). A "segment" match means the pattern
 * matches at the path start or right after a `/`.
 */
export const ROLE_PATTERNS: Record<Exclude<SmartDiffRole, 'core'>, readonly RegExp[]> = {
  boilerplate: [
    /\.lock$/, // *.lock
    /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/, // pnpm-lock.yaml, package-lock.json, yarn.lock
    /^dist\//, // dist/**
    /^build\//, // build/**
    /(?:^|\/)__snapshots__\//, // **/__snapshots__/**
    /\.snap$/, // *.snap
    /(?:^|\/)[^/]*\.generated\.[^/]*$/, // *.generated.*
    /\.min\.js$/, // *.min.js
  ],
  tests: [
    /\.test\.tsx?$/, // **/*.test.ts(x), **/*.it.test.ts
    /\.spec\.ts$/, // **/*.spec.ts
    /(?:^|\/)(?:test|tests|__tests__)\//, // **/test/**, **/tests/**, **/__tests__/**
    /^e2e\//, // e2e/**
  ],
  wiring: [
    /(?:^|\/)index\.(?:ts|js)$/, // index.ts, index.js
    /(?:^|\/)[^/]*\.config\.[^/]*$/, // *.config.*
    /(?:^|\/)tsconfig[^/]*\.json$/, // tsconfig*.json
    /(?:^|\/)\.eslintrc[^/]*$/, // .eslintrc*
    /(?:^|\/)\.env[^/]*$/, // .env*
    /(?:^|\/)docker-compose[^/]*\.yml$/, // docker-compose*.yml
    /^\.github\//, // .github/**
    /^\.claude\//, // .claude/**
  ],
  docs: [
    /\.md$/, // **/*.md
    /^docs\//, // docs/**
    /(?:^|\/)README(?:\.(?:md|mdx|txt|rst))?$/i, // README, README.md|mdx|txt|rst
    /(?:^|\/)CHANGELOG(?:\.(?:md|mdx|txt|rst))?$/i, // CHANGELOG, CHANGELOG.md|mdx|txt|rst
    /(?:^|\/)LICENSE$/i, // LICENSE
  ],
};
