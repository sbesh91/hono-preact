import { describe, it, expect } from 'vitest';
import { createDefaultRoster } from '../default-roster.js';
import type { PresenceMember } from '../room-envelope.js';

describe('default roster (signals-free)', () => {
  it('reads memberIds and member(id) through the getter', () => {
    let arr: ReadonlyArray<PresenceMember<{ x: number }>> = [];
    const store = createDefaultRoster(() => arr);

    expect(store.memberIds.value).toEqual([]);
    expect(store.member('a').value).toBeUndefined();

    arr = [
      { id: 'a', state: { x: 1 } },
      { id: 'b', state: { x: 2 } },
    ];
    expect(store.memberIds.value).toEqual(['a', 'b']);
    expect(store.member('a').value).toEqual({ id: 'a', state: { x: 1 } });
    expect(store.member('z').value).toBeUndefined();
  });

  it('treats delta methods as no-ops (the array is the source)', () => {
    let arr: ReadonlyArray<PresenceMember<number>> = [{ id: 'a', state: 1 }];
    const store = createDefaultRoster(() => arr);

    store.snapshot([{ id: 'x', state: 9 }]);
    store.upsert('a', 2);
    store.leave('a');
    // None of the above changed anything: the getter still returns `arr`.
    expect(store.memberIds.value).toEqual(['a']);
    expect(store.member('a').value).toEqual({ id: 'a', state: 1 });

    arr = [{ id: 'a', state: 2 }];
    expect(store.member('a').value).toEqual({ id: 'a', state: 2 });
  });

  it('exposes the whole roster via members, read through the getter', () => {
    let arr: ReadonlyArray<PresenceMember<number>> = [{ id: 'a', state: 1 }];
    const store = createDefaultRoster(() => arr);
    expect(store.members.value).toEqual([{ id: 'a', state: 1 }]);
    arr = [
      { id: 'a', state: 1 },
      { id: 'b', state: 2 },
    ];
    expect(store.members.value).toEqual(arr);
  });

  it('dispose does not throw', () => {
    const store = createDefaultRoster<number>(() => []);
    expect(() => store.dispose()).not.toThrow();
  });
});
