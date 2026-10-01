/**
 * Spec 06 D3: the in-process per-key gate behind index/clone dedupe
 * (AC-8, AC-10, AC-11 at the primitive level).
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyedGate } from '../src/platform/keyed-gate.js';

type Trailing = 'refresh' | 'resync';
const merge = (a: Trailing, b: Trailing): Trailing => (a === 'resync' || b === 'resync' ? 'resync' : 'refresh');

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('KeyedGate', () => {
  it('reserve twice in one tick → the second is refused', () => {
    const gate = new KeyedGate<Trailing>(merge);
    const a = gate.reserve('r1');
    const b = gate.reserve('r1');
    expect(a.reserved).toBe(true);
    expect(b.reserved).toBe(false);
    expect(gate.isBusy('r1')).toBe(true);
    expect(gate.isBusy('r2')).toBe(false);
  });

  it('release is idempotent and frees the key', () => {
    const gate = new KeyedGate<Trailing>(merge);
    const a = gate.reserve('r1');
    const b = gate.reserve('r1');
    expect(b.reserved).toBe(false);
    if (!a.reserved) throw new Error('expected reservation');
    a.release();
    a.release();
    expect(gate.isBusy('r1')).toBe(false);
    const c = gate.reserve('r1');
    expect(c.reserved).toBe(true);
    // A double release of `a` must not have released `c`.
    a.release();
    expect(gate.isBusy('r1')).toBe(true);
  });

  /** A dispatcher that records hand-offs and holds each one's release. */
  function recorder() {
    const dispatched: Trailing[] = [];
    const releases: Array<() => void> = [];
    const dispatch = vi.fn((_key: string, t: Trailing, release: () => void) => {
      dispatched.push(t);
      releases.push(release);
    });
    return { dispatch, dispatched, releases };
  }

  it('runExclusive while another body runs → coalesced, body not called, one merged trailing dispatched after', async () => {
    const r = recorder();
    const gate = new KeyedGate<Trailing>(merge, undefined, r.dispatch);
    const first = deferred();
    const p1 = gate.runExclusive('r1', 'refresh', () => first.promise);

    const second = vi.fn(async () => undefined);
    await expect(gate.runExclusive('r1', 'refresh', second)).resolves.toBe('coalesced');
    await expect(gate.runExclusive('r1', 'resync', second)).resolves.toBe('coalesced');
    await expect(gate.runExclusive('r1', 'refresh', second)).resolves.toBe('coalesced');
    expect(second).not.toHaveBeenCalled();
    expect(r.dispatch).not.toHaveBeenCalled();

    first.resolve();
    await expect(p1).resolves.toBe('ran');
    expect(r.dispatched).toEqual(['resync']);
    // The hand-off holds the key until the dispatched work releases it.
    expect(gate.isBusy('r1')).toBe(true);
    r.releases[0]!();
    expect(gate.isBusy('r1')).toBe(false);
  });

  it('a request-time reservation refused while busy is dispatched once the holder releases', async () => {
    const r = recorder();
    const gate = new KeyedGate<Trailing>(merge, undefined, r.dispatch);
    const res = gate.reserve('r1');
    if (!res.reserved) throw new Error('expected reservation');
    expect(gate.reserve('r1', 'refresh').reserved).toBe(false);
    await gate.runExclusive('r1', 'refresh', async () => undefined);
    // The body ended but its job has not settled: nothing dispatched yet (F1 window).
    expect(r.dispatch).not.toHaveBeenCalled();
    expect(gate.reserve('r1', 'resync').reserved).toBe(false);
    res.release();
    expect(r.dispatched).toEqual(['resync']);
    expect(gate.isBusy('r1')).toBe(true);
    r.releases[0]!();
    expect(gate.isBusy('r1')).toBe(false);
  });

  it('body throws → error rethrown, lock released, trailing still dispatched', async () => {
    const r = recorder();
    const gate = new KeyedGate<Trailing>(merge, undefined, r.dispatch);
    const first = deferred();
    const p1 = gate.runExclusive('r1', 'refresh', () => first.promise);
    await gate.runExclusive('r1', 'refresh', async () => undefined);
    first.reject(new Error('boom'));
    await expect(p1).rejects.toThrow('boom');
    expect(r.dispatched).toEqual(['refresh']);
    r.releases[0]!();
    expect(gate.isBusy('r1')).toBe(false);
  });

  it('a dispatcher that throws is logged and the key is freed', async () => {
    const warn = vi.fn();
    const gate = new KeyedGate<Trailing>(merge, { warn }, () => {
      throw new Error('trail');
    });
    const first = deferred();
    const p1 = gate.runExclusive('r1', 'refresh', () => first.promise);
    await gate.runExclusive('r1', 'resync', async () => undefined);
    first.resolve();
    await expect(p1).resolves.toBe('ran');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ trailing: 'resync' }), 'gate trailing dispatch failed');
    expect(gate.isBusy('r1')).toBe(false);
  });

  it('a request that arrives during a dispatched pass is dispatched after it', async () => {
    const r = recorder();
    const gate = new KeyedGate<Trailing>(merge, undefined, r.dispatch);
    const res = gate.reserve('r1');
    if (!res.reserved) throw new Error('expected reservation');
    gate.reserve('r1', 'refresh');
    res.release();
    expect(r.dispatched).toEqual(['refresh']);
    expect(gate.reserve('r1', 'resync').reserved).toBe(false);
    r.releases[0]!();
    expect(r.dispatched).toEqual(['refresh', 'resync']);
    r.releases[1]!();
    expect(gate.isBusy('r1')).toBe(false);
  });

  it('timeout case: a released reservation keeps the key busy until the body resolves', async () => {
    const gate = new KeyedGate<Trailing>(merge);
    const r = gate.reserve('r1');
    if (!r.reserved) throw new Error('expected reservation');
    const body = deferred();
    const p = gate.runExclusive('r1', 'refresh', () => body.promise);
    r.release(); // JobRunner timeout settled `done` early
    expect(gate.isBusy('r1')).toBe(true);
    expect(gate.reserve('r1').reserved).toBe(false);
    body.resolve();
    await p;
    expect(gate.isBusy('r1')).toBe(false);
  });

  it('timeout case: a body that throws after its reservation was released frees the key and rethrows', async () => {
    const gate = new KeyedGate<Trailing>(merge);
    const r = gate.reserve('r1');
    if (!r.reserved) throw new Error('expected reservation');
    const body = deferred();
    const p = gate.runExclusive('r1', 'refresh', () => body.promise);
    const settled = p.then(
      () => 'ok',
      (e: Error) => e.message,
    );
    r.release(); // JobRunner timeout settled `done` early
    expect(gate.isBusy('r1')).toBe(true);
    body.reject(new Error('boom'));
    await expect(settled).resolves.toBe('boom');
    expect(gate.isBusy('r1')).toBe(false);
    expect(gate.reserve('r1').reserved).toBe(true);
  });

  it('a throwing body leaves the key reservable again', async () => {
    const gate = new KeyedGate<Trailing>(merge);
    await expect(
      gate.runExclusive('r1', undefined, async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(gate.isBusy('r1')).toBe(false);
    await expect(gate.runExclusive('r1', undefined, async () => undefined)).resolves.toBe('ran');
  });

  it('idle with a trailing pass and no dispatcher → dropped with a warn', async () => {
    const warn = vi.fn();
    const gate = new KeyedGate<Trailing>(merge, { warn });
    const r = gate.reserve('r1');
    if (!r.reserved) throw new Error('expected reservation');
    gate.reserve('r1', 'refresh');
    r.release();
    expect(gate.isBusy('r1')).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'r1', trailing: 'refresh' }),
      'gate dropped a trailing pass: no dispatcher',
    );
    await expect(gate.runExclusive('r1', undefined, async () => undefined)).resolves.toBe('ran');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keys are independent', async () => {
    const gate = new KeyedGate<Trailing>(merge);
    const a = deferred();
    const pa = gate.runExclusive('r1', 'refresh', () => a.promise);
    const bodyB = vi.fn(async () => undefined);
    await expect(gate.runExclusive('r2', 'refresh', bodyB)).resolves.toBe('ran');
    expect(bodyB).toHaveBeenCalledTimes(1);
    a.resolve();
    await pa;
  });
});
