import { describe, it, expect } from 'vitest';
import { createSignalRoster } from '../roster-signal.js';

// The roster keeps one signal per id so a held `member(id)` binding survives its
// member leaving and rejoining. Holding every cell for the life of the hook
// bounds the map by ids EVER SEEN, and a presence key space is unbounded, so a
// long-lived room with churn grows without limit.
//
// The bound: a blanked cell leaves the strong map and is retained only as long
// as something still holds it. These tests pin the half of that which is
// deterministic (identity is preserved for a holder, and reclamation cannot
// break a holder); actual collection is the GC's call and is covered by the
// gc-gated test at the bottom.

type State = { x: number };

describe('roster retention', () => {
  it('keeps a held cell identical across leave and rejoin', () => {
    const roster = createSignalRoster<State>();
    roster.upsert('a', { x: 1 });
    const held = roster.member('a');

    roster.leave('a');
    expect(held.value).toBeUndefined();

    roster.upsert('a', { x: 2 });
    // The holder never re-called `member('a')`, so the rejoin has to land in
    // the cell it is already subscribed to.
    expect(held.value).toEqual({ id: 'a', state: { x: 2 } });
    expect(roster.member('a')).toBe(held);
  });

  it('keeps a held cell identical across a snapshot that drops it', () => {
    const roster = createSignalRoster<State>();
    roster.snapshot([{ id: 'a', state: { x: 1 } }]);
    const held = roster.member('a');

    roster.snapshot([{ id: 'b', state: { x: 9 } }]);
    expect(held.value).toBeUndefined();

    roster.snapshot([{ id: 'a', state: { x: 3 } }]);
    expect(held.value).toEqual({ id: 'a', state: { x: 3 } });
    expect(roster.member('a')).toBe(held);
  });

  it('reports a departed member as absent to a late caller', () => {
    const roster = createSignalRoster<State>();
    roster.upsert('a', { x: 1 });
    roster.leave('a');
    expect(roster.member('a').value).toBeUndefined();
  });

  // `skipIf`, not an early return: without `--expose-gc` this cannot run, and a
  // silent pass would read as coverage the suite does not have. The root `test`
  // script sets the flag, so this is skipped only for someone invoking vitest
  // directly.
  it.skipIf(typeof globalThis.gc !== 'function')(
    'does not retain cells for members who joined and left unheld',
    async () => {
      const gc = globalThis.gc as () => void;
      const roster = createSignalRoster<State>();
      for (let i = 0; i < 500; i++) {
        roster.upsert(`u${i}`, { x: i });
        roster.leave(`u${i}`);
      }
      // Nothing above kept a cell, so every one of them is unreachable.
      gc();
      await new Promise((r) => setTimeout(r, 0));
      gc();

      expect(roster.retainedCellCount()).toBeLessThan(500);
    }
  );

  it('dispose clears retained state', () => {
    const roster = createSignalRoster<State>();
    roster.upsert('a', { x: 1 });
    const held = roster.member('a');
    roster.dispose();
    expect(held.value).toBeUndefined();
    expect(roster.memberIds.value).toEqual([]);
    expect(roster.retainedCellCount()).toBe(0);
  });
});
