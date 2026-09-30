import { createHash } from 'node:crypto';

/** Lowercase hex SHA-256 of the UTF-8 bytes — matches Postgres `encode(sha256(convert_to(x,'UTF8')),'hex')`. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
