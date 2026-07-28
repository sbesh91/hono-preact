// The collect-mode retained log: its cost, and the guarantee that cost buys.
//
// The log exists for exactly one reason -- a consumer that mounts AFTER chunks
// have arrived still folds all of them, so every consumer gets the same answer
// regardless of when it mounted. `live-loaders.mdx` promises that in so many
// words. These tests pin the promise and the invariants that make it cheap.
//
// Why identity and not timing: the fix that made appends O(1) was "stop
// copy-on-writing the array". A timing assertion for that is flaky and says
// nothing about WHY it is fast; the array's identity being stable across every
// append and reset is the actual invariant, and it is deterministic. A
// regression to `[...chunks, chunk]` fails the identity tests immediately.
import { describe, it, expect } from 'vitest';
import { effect } from '@preact/signals';
import {
  createCollectSignals,
  appendCollectChunk,
  resetCollectSignals,
  setCollectError,
  closeCollectSignals,
  foldStream,
} from '../loader-signal.js';

const sum = (acc: number, chunk: unknown) => acc + (chunk as number);

describe('the retained log is appended in place', () => {
  it('keeps ONE array across every append (no copy-on-write)', () => {
    const s = createCollectSignals();
    const identity = s.chunks;
    for (let i = 0; i < 100; i++) appendCollectChunk(s, i);
    // A regression to `chunks.value = [...chunks.value, chunk]` replaces the
    // array on every message, which is the O(n^2) this pins shut.
    expect(s.chunks).toBe(identity);
    expect(s.chunks.length).toBe(100);
  });

  it('truncates in place on reset, so a held reference survives', () => {
    const s = createCollectSignals();
    const identity = s.chunks;
    appendCollectChunk(s, 1);
    resetCollectSignals(s);
    expect(s.chunks).toBe(identity);
    expect(s.chunks.length).toBe(0);
  });

  it('keeps `appended` equal to the log length through every mutator', () => {
    // `appended` is both the notification and the fold bound, so a drift
    // between it and the log would either drop chunks or read past them.
    const s = createCollectSignals();
    const check = () => expect(s.appended.value).toBe(s.chunks.length);
    check();
    appendCollectChunk(s, 'a');
    check();
    appendCollectChunk(s, 'b');
    check();
    resetCollectSignals(s);
    check();
    appendCollectChunk(s, 'c');
    check();
    setCollectError(s, new Error('boom'));
    check();
    closeCollectSignals(s);
    check();
  });
});

describe('the guarantee the log pays for', () => {
  it('a fold created AFTER chunks arrived still consumes all of them', () => {
    const s = createCollectSignals();
    const early = foldStream(s, 0, sum);
    early.value; // subscribe before anything arrives
    for (const n of [1, 2, 3, 4]) appendCollectChunk(s, n);

    // The late mount: created only now, with four chunks already retained.
    const late = foldStream(s, 0, sum);

    expect(late.value.data).toBe(10);
    expect(early.value.data).toBe(10);
  });

  it('folds independently per consumer, off one shared log', () => {
    const s = createCollectSignals();
    const total = foldStream(s, 0, sum);
    const count = foldStream(s, 0, (acc: number) => acc + 1);
    for (const n of [5, 10, 15]) appendCollectChunk(s, n);

    expect(total.value.data).toBe(30);
    expect(count.value.data).toBe(3);
    // One log, two cursors: the log is not consumed by either fold.
    expect(s.chunks.length).toBe(3);
  });

  it('notifies a subscribed fold on append (the mutable log still pushes)', () => {
    // A mutable array cannot notify; `appended` is what does. If an append ever
    // pushed without publishing the length, a bound consumer would silently
    // stop updating -- which is the failure mode this shape risks, so it gets
    // its own test rather than riding on the fold tests above.
    const s = createCollectSignals();
    const folded = foldStream(s, 0, sum);
    const seen: number[] = [];
    const stop = effect(() => {
      const v = folded.value;
      seen.push(v.status === 'connecting' ? -1 : ((v.data as number) ?? -1));
    });
    appendCollectChunk(s, 7);
    appendCollectChunk(s, 3);
    stop();

    expect(seen.at(-1)).toBe(10);
    expect(seen.length).toBeGreaterThan(1);
  });

  it('refolds from scratch after a reset instead of continuing the old total', () => {
    const s = createCollectSignals();
    const folded = foldStream(s, 0, sum);
    appendCollectChunk(s, 100);
    expect(folded.value.data).toBe(100);

    resetCollectSignals(s);
    appendCollectChunk(s, 5);

    // 5, not 105: the epoch bump resets the retained cursor and accumulator.
    expect(folded.value.data).toBe(5);
  });
});
