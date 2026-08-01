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
  beginCollectResubscribe,
  setCollectError,
  closeCollectSignals,
  foldStream,
} from '../loader-signal.js';

const sum = (acc: number, chunk: unknown) => acc + (chunk as number);

describe('the retained log is appended in place', () => {
  it('keeps ONE array across every append (no copy-on-write, one generation)', () => {
    const s = createCollectSignals();
    const identity = s.run.value.chunks;
    for (let i = 0; i < 100; i++) appendCollectChunk(s, i);
    // A regression to copy-on-write replaces the array on every message, which
    // is both the O(n^2) this pins shut AND, now that array identity IS the
    // generation, a spurious generation per chunk.
    expect(s.run.value.chunks).toBe(identity);
    expect(s.run.value.chunks.length).toBe(100);
  });

  it('mints a NEW array when a resubscribe delivers (a new generation)', () => {
    const s = createCollectSignals();
    const first = s.run.value.chunks;
    appendCollectChunk(s, 1);
    beginCollectResubscribe(s);
    expect(s.run.value.chunks).toBe(first); // armed, not yet replaced

    appendCollectChunk(s, 2); // the delivering chunk starts the generation
    expect(s.run.value.chunks).not.toBe(first);
    expect(s.run.value.chunks).toEqual([2]);
  });

  it('keeps the published length equal to the array length through every mutator', () => {
    // The run's published `length` is the fold bound, so a drift between it
    // and the array would either drop chunks or read past them.
    const s = createCollectSignals();
    const check = () =>
      expect(s.run.value.length).toBe(s.run.value.chunks.length);
    check();
    appendCollectChunk(s, 'a');
    check();
    appendCollectChunk(s, 'b');
    check();
    beginCollectResubscribe(s);
    check(); // still 2: an armed resubscribe has not dropped anything yet
    appendCollectChunk(s, 'c');
    check(); // now 1: the delivering chunk truncated
    expect(s.run.value.chunks).toEqual(['c']);
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
    expect(s.run.value.chunks.length).toBe(3);
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

  it('refolds from scratch once a resubscribe delivers, not before', () => {
    const s = createCollectSignals();
    const folded = foldStream(s, 0, sum);
    appendCollectChunk(s, 100);
    expect(folded.value.data).toBe(100);

    // Armed but not yet delivered: the prior stream stays folded and on screen.
    // This is what makes a failed reconnect non-destructive.
    beginCollectResubscribe(s);
    expect(folded.value.data).toBe(100);
    // `reconnecting`, not `connecting` (which carries no data and would blank
    // the retained fold) and no longer the previous status either: holding that
    // was the F3 shortcut this replaced, and it left an author nothing to branch
    // on. See collect-reconnecting-status.test.ts.
    expect(s.run.value.status).toBe('reconnecting');

    appendCollectChunk(s, 5);

    // 5, not 105: the delivering chunk mints a new generation, so the retained
    // cursor and accumulator both restart.
    expect(folded.value.data).toBe(5);
  });

  it('keeps the prior stream when a resubscribe never delivers', () => {
    // The reconnect-failure shape, at the store level: armed, then an error
    // instead of a chunk. Nothing was discarded, so the fold survives.
    const s = createCollectSignals();
    const folded = foldStream(s, 0, sum);
    appendCollectChunk(s, 7);
    appendCollectChunk(s, 3);
    beginCollectResubscribe(s);
    setCollectError(s, new Error('reconnect refused'));

    expect(folded.value.data).toBe(10);
    expect(folded.value.status).toBe('error');
  });
});

// R8: a reducer that MUTATES its accumulator and returns it aliases the
// caller's `initial`, so the generation reset (`acc = initial`) restores an
// object the reducer has already filled. The fold then appends the new stream
// onto the old one, duplicating history on every reconnect and growing without
// bound.
//
// The shape is detectable in O(1): a mutating reducer is exactly the one that
// returns the object it was handed. Detected on the FIRST fold, so it fails
// before any corruption is observable rather than at the reconnect that would
// expose it.
describe('a mutating reducer is rejected, not silently corrupted', () => {
  it('throws on a reducer that pushes into and returns its accumulator', () => {
    const s = createCollectSignals();
    const folded = foldStream<string[]>(s, [], (acc, line) => {
      (acc as string[]).push(line as string);
      return acc as string[];
    });
    appendCollectChunk(s, 'a');
    expect(() => folded.value).toThrow(/mutat/i);
  });

  it('names the fix in the message', () => {
    const s = createCollectSignals();
    const folded = foldStream<number[]>(s, [], (acc, n) => {
      (acc as number[]).push(n as number);
      return acc as number[];
    });
    appendCollectChunk(s, 1);
    let message = '';
    try {
      folded.value;
    } catch (e) {
      message = (e as Error).message;
    }
    // A user hitting this needs the remedy, not just the diagnosis.
    expect(message).toMatch(/return a new/i);
  });

  it('leaves a pure reducer alone, including one returning a primitive', () => {
    const s = createCollectSignals();
    const total = foldStream(s, 0, sum);
    const list = foldStream<readonly number[]>(s, [], (acc, n) => [
      ...(acc as number[]),
      n as number,
    ]);
    appendCollectChunk(s, 5);
    appendCollectChunk(s, 6);
    expect(total.value.data).toBe(11);
    expect(list.value.data).toEqual([5, 6]);
  });

  it('does not fire for a primitive `initial`, which cannot be mutated', () => {
    // `(acc) => acc` returns its input, but a number cannot be corrupted by it,
    // so flagging it would be a false positive on a legal (if degenerate) fold.
    const s = createCollectSignals();
    const folded = foldStream<number>(s, 0, (acc) => acc as number);
    appendCollectChunk(s, 1);
    expect(() => folded.value).not.toThrow();
    expect(folded.value.data).toBe(0);
  });
});

// T2 (review round 3): the guard above keyed on `next === initial`, which a
// MUTATING reducer and an ordinary FILTERING one both satisfy on the first
// chunk of a generation. Identity alone cannot tell them apart; only whether
// `initial` was actually mutated can.
describe('T2: a filtering reducer that passes its accumulator through is legal', () => {
  it('does not throw when the first chunk of a generation is filtered out', () => {
    const s = createCollectSignals();
    // The canonical shape: keep `tick` frames, drop everything else. The stream
    // opens with a heartbeat, so `reduce` returns the `[]` it was handed.
    const folded = foldStream<readonly string[]>(s, [], (acc, ev) =>
      (ev as string).startsWith('tick')
        ? [...(acc as string[]), ev as string]
        : (acc as string[])
    );
    appendCollectChunk(s, 'hello');
    expect(() => folded.value).not.toThrow();
    expect(folded.value.data).toEqual([]);
  });

  it('still folds correctly once matching chunks arrive', () => {
    const s = createCollectSignals();
    const folded = foldStream<readonly string[]>(s, [], (acc, ev) =>
      (ev as string).startsWith('tick')
        ? [...(acc as string[]), ev as string]
        : (acc as string[])
    );
    appendCollectChunk(s, 'hello');
    appendCollectChunk(s, 'tick-1');
    appendCollectChunk(s, 'noise');
    appendCollectChunk(s, 'tick-2');
    expect(folded.value.data).toEqual(['tick-1', 'tick-2']);
  });
});

// The fingerprint check is strictly stronger than the identity check it
// replaced, not merely narrower: this reducer corrupts `initial` and then
// returns a COPY, so `next !== initial` and the old guard let it through.
describe('T2: mutation is detected however the reducer returns', () => {
  it('rejects a reducer that mutates `initial` but returns a copy', () => {
    const s = createCollectSignals();
    const folded = foldStream<readonly number[]>(s, [], (acc, n) => {
      (acc as number[]).push(n as number);
      return [...(acc as number[])];
    });
    appendCollectChunk(s, 1);
    expect(() => folded.value).toThrow(/must not mutate/);
  });

  it('rejects an in-place field update on an object `initial`', () => {
    const s = createCollectSignals();
    const folded = foldStream<{ total: number }>(s, { total: 0 }, (acc, n) => {
      (acc as { total: number }).total += n as number;
      return acc as { total: number };
    });
    appendCollectChunk(s, 5);
    expect(() => folded.value).toThrow(/must not mutate/);
  });
});
