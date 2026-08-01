// @vitest-environment happy-dom
// `useOptimisticAction` used to read its internal `valueSignal.value` eagerly in
// the hook body, which subscribed the HOST to the optimistic queue whether or
// not the host ever rendered the projection, and left no signal for a caller to
// hand a leaf. `value` is now a lazy getter over the exposed `valueSignal`, so
// the subscription follows the read.
//
// These are render-counted rather than assertion-on-output, because the whole
// defect was invisible in output: the right values rendered, just in too many
// components.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import type { ReadonlySignal } from '@preact/signals';
import { useOptimistic } from '../optimistic.js';
import { useOptimisticAction, OPTIMISTIC_BRAND } from '../optimistic-action.js';
import type { ActionRef } from '../action.js';

const stub = {
  __module: 'movies',
  __action: 'create',
} as unknown as ActionRef<{ title: string }, { id: number; title: string }>;

afterEach(cleanup);

describe('useOptimisticAction render granularity', () => {
  it('does not re-render a host that never reads `value`', async () => {
    let hostRenders = 0;
    let add!: (p: { title: string }) => unknown;
    let projection!: ReadonlySignal<string[]>;

    function Host({ base }: { base: string[] }) {
      hostRenders++;
      const result = useOptimisticAction(stub, {
        base,
        apply: (cur, p) => [...cur, p.title],
      });
      // Dispatch through the brand so no network is involved.
      add = result[OPTIMISTIC_BRAND].addOptimistic;
      projection = result.valueSignal;
      // `result.value` is deliberately NEVER read.
      return null;
    }

    render(<Host base={['Alien']} />);
    const before = hostRenders;

    await act(async () => {
      add({ title: 'Dune' });
    });

    expect(hostRenders).toBe(before);
    // Not vacuous: the dispatch really did move the projection.
    expect(projection.peek()).toEqual(['Alien', 'Dune']);
  });

  it('CONTROL: still re-renders a host that DOES read `value` during render', async () => {
    let hostRenders = 0;
    let seen: string[] = [];
    let add!: (p: { title: string }) => unknown;

    function Host({ base }: { base: string[] }) {
      hostRenders++;
      const result = useOptimisticAction(stub, {
        base,
        apply: (cur, p) => [...cur, p.title],
      });
      add = result[OPTIMISTIC_BRAND].addOptimistic;
      seen = result.value;
      return null;
    }

    render(<Host base={['Alien']} />);
    const before = hostRenders;

    await act(async () => {
      add({ title: 'Dune' });
    });

    // The pre-existing contract: reading the projection tracks it.
    expect(hostRenders).toBeGreaterThan(before);
    expect(seen).toEqual(['Alien', 'Dune']);
  });

  it('re-renders only the leaf when `valueSignal` is handed down', async () => {
    let hostRenders = 0;
    let leafRenders = 0;
    let leafSaw: string[] = [];
    let add!: (p: { title: string }) => unknown;

    function Leaf({ items }: { items: ReadonlySignal<string[]> }) {
      leafRenders++;
      leafSaw = items.value;
      return null;
    }

    function Host({ base }: { base: string[] }) {
      hostRenders++;
      const result = useOptimisticAction(stub, {
        base,
        apply: (cur, p) => [...cur, p.title],
      });
      add = result[OPTIMISTIC_BRAND].addOptimistic;
      return <Leaf items={result.valueSignal} />;
    }

    render(<Host base={['Alien']} />);
    const hostBefore = hostRenders;
    const leafBefore = leafRenders;

    await act(async () => {
      add({ title: 'Dune' });
    });

    expect(hostRenders).toBe(hostBefore);
    expect(leafRenders).toBeGreaterThan(leafBefore);
    expect(leafSaw).toEqual(['Alien', 'Dune']);
  });

  it('`useOptimistic` delivers the same leaf granularity', async () => {
    let hostRenders = 0;
    let leafRenders = 0;
    let leafSaw: string[] = [];
    let add!: (p: string) => unknown;

    function Leaf({ items }: { items: ReadonlySignal<string[]> }) {
      leafRenders++;
      leafSaw = items.value;
      return null;
    }

    function Host({ base }: { base: string[] }) {
      hostRenders++;
      const [items, addOptimistic] = useOptimistic(
        base,
        (cur: string[], p: string) => [...cur, p]
      );
      add = addOptimistic;
      return <Leaf items={items} />;
    }

    render(<Host base={['Alien']} />);
    const hostBefore = hostRenders;
    const leafBefore = leafRenders;

    await act(async () => {
      add('Dune');
    });

    expect(hostRenders).toBe(hostBefore);
    expect(leafRenders).toBeGreaterThan(leafBefore);
    expect(leafSaw).toEqual(['Alien', 'Dune']);
  });
});
