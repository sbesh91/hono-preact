// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createSignalRoster } from '../roster-signal.js';

describe('signal-backed roster', () => {
  it('tracks snapshot, upsert, and leave', () => {
    const store = createSignalRoster<{ x: number }>();

    store.snapshot([{ id: 'a', state: { x: 1 } }]);
    expect(store.memberIds.value).toEqual(['a']);
    expect(store.member('a').value).toEqual({ id: 'a', state: { x: 1 } });

    store.upsert('b', { x: 2 });
    expect(store.memberIds.value).toEqual(['a', 'b']);

    store.upsert('a', { x: 9 });
    expect(store.member('a').value).toEqual({ id: 'a', state: { x: 9 } });

    store.leave('a');
    expect(store.memberIds.value).toEqual(['b']);
    expect(store.member('a').value).toBeUndefined();
  });

  it('returns a STABLE signal per id (identity preserved across calls)', () => {
    const store = createSignalRoster<number>();
    store.upsert('a', 1);
    expect(store.member('a')).toBe(store.member('a'));
  });

  it('an update to one member does NOT change the memberIds identity', () => {
    // The granularity invariant at the store level: updating a member touches
    // only that member's signal, never the ids signal. If `upsert` rewrote
    // `memberIds` on every call, this reference check would fail.
    const store = createSignalRoster<number>();
    store.snapshot([{ id: 'a', state: 1 }]);
    const idsBefore = store.memberIds.value;
    store.upsert('a', 2); // existing member update
    expect(store.memberIds.value).toBe(idsBefore);
  });

  it('members reflects the roster and tracks an update', () => {
    const store = createSignalRoster<number>();
    store.snapshot([
      { id: 'a', state: 1 },
      { id: 'b', state: 2 },
    ]);
    expect(store.members.value).toEqual([
      { id: 'a', state: 1 },
      { id: 'b', state: 2 },
    ]);
    store.upsert('a', 9);
    expect(store.members.value).toEqual([
      { id: 'a', state: 9 },
      { id: 'b', state: 2 },
    ]);
  });

  it('snapshot dedupes a duplicate id in ids while byId keeps one signal', () => {
    const store = createSignalRoster<number>();
    store.snapshot([
      { id: 'a', state: 1 },
      { id: 'a', state: 2 },
    ]);
    expect(store.memberIds.value).toEqual(['a']);
    expect(store.member('a').value).toEqual({ id: 'a', state: 2 });
  });
});

describe('retention', () => {
  it('dispose() releases the per-id cells the store retains', () => {
    const roster = createSignalRoster<number>();
    roster.snapshot([
      { id: 'a', state: 1 },
      { id: 'b', state: 2 },
    ]);
    // `member()` get-or-creates on READ, so asking about an id that never
    // joined retains a cell for it too. This is the unbounded axis the doc
    // comment on the factory calls out.
    const ghost = roster.member('never-joined');
    expect(ghost.value).toBeUndefined();

    const a = roster.member('a');
    expect(a.value).toEqual({ id: 'a', state: 1 });

    roster.dispose();

    // Every held binding is blanked, not merely orphaned: a consumer still
    // rendering one after unmount sees absence rather than a stale member.
    expect(a.value).toBeUndefined();
    expect(ghost.value).toBeUndefined();
    expect(roster.memberIds.value).toEqual([]);
    expect(roster.members.value).toEqual([]);
  });
});
