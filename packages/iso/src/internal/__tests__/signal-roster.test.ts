// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import {
  getPresenceReactiveImpl,
  registerPresenceReactiveImpl,
} from '../reactive.js';
import { installPresenceSignals } from '../../signals.js';

afterEach(() => registerPresenceReactiveImpl(null));

describe('signal-backed roster', () => {
  it('registers an implementation on install', () => {
    installPresenceSignals();
    expect(getPresenceReactiveImpl()).not.toBeNull();
  });

  it('tracks snapshot, upsert, and leave', () => {
    installPresenceSignals();
    const store = getPresenceReactiveImpl()!.createRoster<{ x: number }>();

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
    installPresenceSignals();
    const store = getPresenceReactiveImpl()!.createRoster<number>();
    store.upsert('a', 1);
    expect(store.member('a')).toBe(store.member('a'));
  });

  it('an update to one member does NOT change the memberIds identity', () => {
    // The granularity invariant at the store level: updating a member touches
    // only that member's signal, never the ids signal. If `upsert` rewrote
    // `memberIds` on every call, this reference check would fail.
    installPresenceSignals();
    const store = getPresenceReactiveImpl()!.createRoster<number>();
    store.snapshot([{ id: 'a', state: 1 }]);
    const idsBefore = store.memberIds.value;
    store.upsert('a', 2); // existing member update
    expect(store.memberIds.value).toBe(idsBefore);
  });

  it('members reflects the roster and tracks an update', () => {
    installPresenceSignals();
    const store = getPresenceReactiveImpl()!.createRoster<number>();
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
    installPresenceSignals();
    const store = getPresenceReactiveImpl()!.createRoster<number>();
    store.snapshot([
      { id: 'a', state: 1 },
      { id: 'a', state: 2 },
    ]);
    expect(store.memberIds.value).toEqual(['a']);
    expect(store.member('a').value).toEqual({ id: 'a', state: 2 });
  });
});
