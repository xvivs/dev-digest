/** Input fields shared by several tools (Tool contracts). */
import { z } from 'zod';

export const repoArg = z
  .string()
  .max(200)
  .regex(/^[\w.-]+\/[\w.-]+$/, 'must be "owner/name"')
  .describe('GitHub repository as "owner/name", as imported in DevDigest.');

export const prNumberArg = z.number().int().positive().describe('Pull request number on GitHub.');

export const SeverityCountsOutput = z.object({
  CRITICAL: z.number().int(),
  WARNING: z.number().int(),
  SUGGESTION: z.number().int(),
});
