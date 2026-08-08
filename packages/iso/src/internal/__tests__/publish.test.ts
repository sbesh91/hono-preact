import { describe, it, expect } from 'vitest';
import { signal, computed } from '@preact/signals';
import { publish, retainEquivalent } from '../publish.js';

describe('publish', () => {
  it('does not notify for a structurally equal value', () => {
    const s = signal<number[]>([1, 2]);
    let notifications = 0;
    const stop = s.subscribe(() => notifications++);
    notifications = 0;

    publish(s, [1, 2]);
    expect(notifications).toBe(0);
    // The retained value is the ORIGINAL reference, not the rejected one.
    expect(s.peek()).toEqual([1, 2]);
    stop();
  });

  it('notifies for a real change', () => {
    const s = signal<number[]>([1, 2]);
    let notifications = 0;
    const stop = s.subscribe(() => notifications++);
    notifications = 0;

    publish(s, [1, 2, 3]);
    expect(notifications).toBe(1);
    stop();
  });

  it('honours a custom comparator for values the default cannot see into', () => {
    type Member = { id: string; state: { x: number } };
    const s = signal<Member>({ id: 'a', state: { x: 1 } });
    const byState = (a: Member, b: Member) =>
      a.id === b.id && a.state.x === b.state.x;
    let notifications = 0;
    const stop = s.subscribe(() => notifications++);
    notifications = 0;

    // The default would see a fresh `state` object and publish; this must not.
    publish(s, { id: 'a', state: { x: 1 } }, byState);
    expect(notifications).toBe(0);

    publish(s, { id: 'a', state: { x: 2 } }, byState);
    expect(notifications).toBe(1);
    stop();
  });

  it('reads through peek, so it never subscribes its caller', () => {
    const s = signal<number[]>([1]);
    const other = signal(0);
    // A computed that publishes to `s` must not become a subscriber of `s`.
    const c = computed(() => {
      publish(s, [other.value]);
      return other.value;
    });
    expect(c.value).toBe(0);
    // If `publish` had read `s.value`, writing `s` would invalidate `c` and
    // this would recurse or throw a cycle error.
    publish(s, [99]);
    expect(c.value).toBe(0);
  });
});

describe('retainEquivalent', () => {
  it('returns the previous value when the new one is equivalent', () => {
    const retain = retainEquivalent<number[]>();
    const first = retain([1, 2]);
    const second = retain([1, 2]);
    expect(second).toBe(first);
  });

  it('returns the new value when it differs', () => {
    const retain = retainEquivalent<number[]>();
    const first = retain([1, 2]);
    const second = retain([1, 2, 3]);
    expect(second).not.toBe(first);
    expect(second).toEqual([1, 2, 3]);
  });

  it('re-baselines, so an equivalent of the LATEST is retained', () => {
    const retain = retainEquivalent<number[]>();
    retain([1]);
    const b = retain([2]);
    const c = retain([2]);
    expect(c).toBe(b);
  });

  it('handles undefined and null as real values, not "nothing retained yet"', () => {
    const retain = retainEquivalent<number[] | undefined>();
    const first = retain(undefined);
    expect(first).toBeUndefined();
    // Must not treat the retained `undefined` as "no previous" and re-publish.
    const arr = retain([1]);
    expect(arr).toEqual([1]);
    expect(retain([1])).toBe(arr);
  });

  it('honours a custom comparator', () => {
    type S = { status: string; data: number[] };
    const eq = (a: S, b: S) => a.status === b.status;
    const retain = retainEquivalent<S>(eq);
    const first = retain({ status: 'open', data: [1] });
    // Different data, same status: the comparator says equivalent.
    expect(retain({ status: 'open', data: [9] })).toBe(first);
    expect(retain({ status: 'closed', data: [1] })).not.toBe(first);
  });

  it('lets a computed dedupe, which is the whole point', () => {
    const src = signal(0);
    const retain = retainEquivalent<{ n: number }>((a, b) => a.n === b.n);
    // Rebuilds a fresh object every recompute; retention makes it `===` stable.
    const c = computed(() => retain({ n: src.value % 2 }));
    let notifications = 0;
    const stop = c.subscribe(() => notifications++);
    notifications = 0;

    src.value = 2; // still n === 0
    expect(notifications).toBe(0);
    src.value = 3; // n === 1
    expect(notifications).toBe(1);
    stop();
  });
});
