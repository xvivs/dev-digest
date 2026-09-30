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

/**
 * Patterns per role. Every regex is anchored and linear (no nested quantifiers,
 * no backreferences): paths come from PR authors. A "segment" match means the
 * pattern matches at the path start or right after a `/`.
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
    /(?:^|\/)README[^/]*$/i, // README*
    /(?:^|\/)CHANGELOG[^/]*$/i, // CHANGELOG*
    /(?:^|\/)LICENSE$/i, // LICENSE
  ],
};
