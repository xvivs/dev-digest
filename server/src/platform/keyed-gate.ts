/**
 * KeyedGate — an in-process, per-key gate for job work (spec 06 D3, ADR 0025).
 *
 * Two halves share one state per key:
 *  - `reserve(key)` at request time: synchronous, so two callers in one tick
 *    cannot both pass. The caller releases the reservation exactly once, when
 *    its job settles (`job.done`) or when enqueueing fails.
 *  - `runExclusive(key, …)` at handler time: one body per key at a time. A
 *    handler that finds a body already running does not run its own; it merges
 *    `contendedAs` into the pending trailing pass.
 *
 * The key stays busy while any reservation is held OR a body runs — a
 * JobRunner timeout settles `done` early while the handler keeps going, so the
 * lock must not hang off `done`.
 *
 * Trailing passes never run inside the current body's job. When the key goes
 * fully idle (no reservation, no body) with a trailing pass pending, the gate
 * takes a new reservation for it and hands both to `dispatch`, which enqueues
 * the pass as a job of its own (own timeout budget) and releases the
 * reservation when that job settles. Idle-time hand-off is what keeps a request
 * that lands between the body's end and its job's `done` from being dropped.
 *
 * Single-process only (ADR 0020): another process gets its own gate.
 */

export interface GateLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/** Enqueue `trailing` for `key`; call `release` exactly once when that work settles or fails to start. */
export type TrailingDispatch<T> = (key: string, trailing: T, release: () => void) => void;

interface GateEntry<T> {
  queued: number;
  running: boolean;
  trailing: T | null;
}

export type GateReservation = { reserved: true; release(): void } | { reserved: false };

export class KeyedGate<T> {
  private entries = new Map<string, GateEntry<T>>();

  constructor(
    private merge: (a: T, b: T) => T,
    private logger?: GateLogger,
    private dispatch?: TrailingDispatch<T>,
  ) {}

  isBusy(key: string): boolean {
    const e = this.entries.get(key);
    return e !== undefined && (e.queued > 0 || e.running);
  }

  /**
   * Reserve the key if idle. When busy, `trailing` (if given) is merged into
   * the pending trailing pass and `{ reserved: false }` is returned.
   * `release` is idempotent.
   */
  reserve(key: string, trailing?: T): GateReservation {
    if (this.isBusy(key)) {
      if (trailing !== undefined) this.addTrailing(this.entries.get(key)!, trailing);
      return { reserved: false };
    }
    return { reserved: true, release: this.hold(key, this.entry(key)) };
  }

  /**
   * Run `body` exclusively for `key`. If another body is running, merge
   * `contendedAs` into the trailing pass and return `'coalesced'` without
   * calling `body`. A body error is rethrown after the lock is released.
   */
  async runExclusive(
    key: string,
    contendedAs: T | undefined,
    body: () => Promise<void>,
  ): Promise<'ran' | 'coalesced'> {
    const entry = this.entry(key);
    if (entry.running) {
      if (contendedAs !== undefined) this.addTrailing(entry, contendedAs);
      return 'coalesced';
    }
    entry.running = true;
    try {
      await body();
    } finally {
      entry.running = false;
      this.settle(key, entry);
    }
    return 'ran';
  }

  private entry(key: string): GateEntry<T> {
    let e = this.entries.get(key);
    if (!e) {
      e = { queued: 0, running: false, trailing: null };
      this.entries.set(key, e);
    }
    return e;
  }

  /** Count one reservation on `entry`; the returned release is idempotent. */
  private hold(key: string, entry: GateEntry<T>): () => void {
    entry.queued += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.queued -= 1;
      this.settle(key, entry);
    };
  }

  private addTrailing(entry: GateEntry<T>, next: T): void {
    entry.trailing = entry.trailing === null ? next : this.merge(entry.trailing, next);
  }

  /** Called whenever a reservation or a body ends: hand off a pending trailing pass, or forget the key. */
  private settle(key: string, entry: GateEntry<T>): void {
    if (entry.queued > 0 || entry.running) return;
    if (this.entries.get(key) !== entry) return;
    const trailing = entry.trailing;
    if (trailing === null) {
      this.entries.delete(key);
      return;
    }
    entry.trailing = null;
    if (!this.dispatch) {
      this.logger?.warn({ key, trailing }, 'gate dropped a trailing pass: no dispatcher');
      this.entries.delete(key);
      return;
    }
    // Reserve before dispatching so the key never reads idle during the hand-off.
    const release = this.hold(key, entry);
    try {
      this.dispatch(key, trailing, release);
    } catch (err) {
      this.logger?.warn(
        { key, trailing, err: err instanceof Error ? err.message : String(err) },
        'gate trailing dispatch failed',
      );
      release();
    }
  }
}
