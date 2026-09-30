import type { SmartDiffRole } from '@devdigest/shared';
import { CLASSIFY_ORDER, MAX_PATH_LENGTH, MAX_SEGMENT_LENGTH, ROLE_PATTERNS } from './constants.js';

/**
 * Smart Diff role of a repo-relative POSIX path. Pure: no I/O.
 * First role in CLASSIFY_ORDER with a matching pattern wins, else `core`.
 */
export function classifyFile(path: string): SmartDiffRole {
  const p = path.startsWith('./') ? path.slice(2) : path;
  if (p.length > MAX_PATH_LENGTH || p.split('/').some((seg) => seg.length > MAX_SEGMENT_LENGTH)) {
    return 'core'; // attacker-sized path: skip the regexes (quadratic on long segments)
  }
  for (const role of CLASSIFY_ORDER) {
    if (ROLE_PATTERNS[role].some((re) => re.test(p))) return role;
  }
  return 'core';
}
