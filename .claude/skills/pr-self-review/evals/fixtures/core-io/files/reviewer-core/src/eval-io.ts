import { readFileSync } from 'node:fs';

/** Loads a reviewer system prompt from disk. */
export function loadSystemPrompt(path: string): string {
  return readFileSync(path, 'utf8').trim();
}
