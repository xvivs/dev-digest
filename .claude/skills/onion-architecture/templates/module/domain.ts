/**
 * DOMAIN — the core ring of the `example` module. Pure: no I/O, no container,
 * no Drizzle, no Fastify, no runtime zod. Only `import type` from
 * `@devdigest/shared` and the error taxonomy in `platform/errors.ts`.
 *
 * Put here: the entity shape the service works with, invariants as pure
 * functions, and module-specific domain errors.
 */
import { AppError } from '../../platform/errors.js';

/** What the service reads and writes. Not a Drizzle row, not an HTTP DTO. */
export interface Example {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
}

export interface NewExample {
  workspaceId: string;
  name: string;
}

export const EXAMPLE_NAME_MAX = 80;

/** Invariant: a business rule, not an HTTP contract — keep it out of `.refine()`. */
export function normalizeExampleName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > EXAMPLE_NAME_MAX) {
    throw new InvalidExampleNameError(raw);
  }
  return name;
}

export class InvalidExampleNameError extends AppError {
  constructor(raw: string) {
    super('example_invalid_name', `Invalid example name: "${raw}"`, 422, { raw });
  }
}

export class ExampleNameTakenError extends AppError {
  constructor(name: string) {
    super('example_name_taken', `An example named "${name}" already exists`, 409, { name });
  }
}
