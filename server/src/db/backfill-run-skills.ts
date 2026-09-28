import 'dotenv/config';
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { createDb } from './client.js';

/**
 * One-off backfill of `run_skills` (plan Phase 2) from the `skills_used`
 * snapshot every run trace already carries
 * (`run_traces.trace.prompt_assembly.skills_used`).
 *
 * A script, not a `--custom` migration: `run_traces` grows with every run, so
 * the copy goes in keyset-paginated batches (by `run_id`) that each commit on
 * their own, instead of one long transaction inside `pnpm db:migrate`.
 *
 *  - Resumable: every batch logs its cursor. `--after=<run_id>` restarts right
 *    after it; re-running from the start is also safe, because the insert is
 *    `ON CONFLICT DO NOTHING`.
 *  - Deleted skills are skipped (INNER JOIN on `skills`); their history lives
 *    on in the trace only.
 *  - `body_sha256` is the trace's `skills_used.sha256`, which hashes the BODY
 *    only (`skills/repository.ts` `resolveEffectiveSkills`).
 *  - `prompt_sha256 = sha256(name + "\n" + body)` needs the body, which the
 *    trace does not hold. It is taken from `skill_versions` at the traced
 *    version, and only when that snapshot's body hashes to the traced sha256;
 *    otherwise (lost history, tampered snapshot) it stays NULL.
 *  - Malformed entries (no array, non-uuid id, non-numeric version) are
 *    skipped, never cast into an error that would stop the batch.
 */

export const BACKFILL_DEFAULT_BATCH = 500;

export interface BackfillRunSkillsResult {
  batches: number;
  tracesScanned: number;
  rowsInserted: number;
  /** Cursor after the last batch; pass it as `after` to resume. */
  lastRunId: string | null;
}

export async function backfillRunSkills(
  db: Db,
  opts: { batchSize?: number; after?: string | null; log?: (msg: string) => void } = {},
): Promise<BackfillRunSkillsResult> {
  const batchSize = opts.batchSize ?? BACKFILL_DEFAULT_BATCH;
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  let cursor = opts.after ?? null;
  const result: BackfillRunSkillsResult = { batches: 0, tracesScanned: 0, rowsInserted: 0, lastRunId: cursor };

  for (;;) {
    const rows = await db.execute<{ scanned: number; last_run_id: string | null; inserted: number }>(sql`
      WITH batch AS (
        SELECT run_id, trace
        FROM run_traces
        WHERE ${cursor}::uuid IS NULL OR run_id > ${cursor}::uuid
        ORDER BY run_id
        LIMIT ${batchSize}
      ),
      used AS (
        SELECT b.run_id, e.value AS e
        FROM batch b
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(b.trace -> 'prompt_assembly' -> 'skills_used') = 'array'
               THEN b.trace -> 'prompt_assembly' -> 'skills_used'
               ELSE '[]'::jsonb END
        ) AS e(value)
        WHERE jsonb_typeof(e.value -> 'version') = 'number'
          AND jsonb_typeof(e.value -> 'sha256') = 'string'
      ),
      ins AS (
        INSERT INTO run_skills (run_id, skill_id, skill_version, body_sha256, prompt_sha256, tokens)
        SELECT
          u.run_id,
          s.id,
          (u.e ->> 'version')::numeric::int,
          u.e ->> 'sha256',
          CASE
            WHEN sv.body IS NOT NULL
             AND encode(sha256(convert_to(sv.body, 'UTF8')), 'hex') = u.e ->> 'sha256'
            THEN encode(
              sha256(convert_to(coalesce(u.e ->> 'name', s.name) || E'\n' || sv.body, 'UTF8')),
              'hex'
            )
          END,
          CASE WHEN jsonb_typeof(u.e -> 'tokens') = 'number'
               THEN (u.e ->> 'tokens')::numeric::int ELSE 0 END
        FROM used u
        JOIN skills s ON s.id::text = u.e ->> 'id'
        LEFT JOIN skill_versions sv
          ON sv.skill_id = s.id AND sv.version = (u.e ->> 'version')::numeric::int
        ON CONFLICT (run_id, skill_id) DO NOTHING
        RETURNING 1
      )
      SELECT
        (SELECT count(*)::int FROM batch) AS scanned,
        (SELECT max(run_id::text) FROM batch) AS last_run_id,
        (SELECT count(*)::int FROM ins) AS inserted
    `);
    const row = rows[0];
    const scanned = Number(row?.scanned ?? 0);
    if (scanned === 0) break;

    result.batches += 1;
    result.tracesScanned += scanned;
    result.rowsInserted += Number(row?.inserted ?? 0);
    // uuid and its canonical lowercase text sort the same, so max(text) is the
    // batch's last run_id in `ORDER BY run_id` order.
    cursor = row?.last_run_id ?? cursor;
    result.lastRunId = cursor;
    opts.log?.(
      `batch ${result.batches}: ${scanned} trace(s), +${Number(row?.inserted ?? 0)} row(s); resume with --after=${cursor}`,
    );
    if (scanned < batchSize) break;
  }
  return result;
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

// CLI entrypoint: pnpm db:backfill:run-skills [--after=<run_id>] [--batch=<n>]
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const batch = argValue('batch');
  const handle = createDb(url, { max: 1 });
  backfillRunSkills(handle.db, {
    after: argValue('after') ?? null,
    batchSize: batch ? Number(batch) : undefined,
    log: (msg) => console.log(msg),
  })
    .then(async (r) => {
      console.log('✓ run_skills backfilled', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ run_skills backfill failed:', err);
      await handle.close();
      process.exit(1);
    });
}
