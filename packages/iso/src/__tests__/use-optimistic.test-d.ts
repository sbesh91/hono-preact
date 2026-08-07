// Type-level pin: `useOptimistic`'s returned tuple's first element is a
// `ReadonlySignal<TBase>` (a reactive read hook, Phase 3 of the signals
// migration), not a plain `TBase`. Run under `pnpm test:types`.
import { expectTypeOf } from 'vitest';
import type { ReadonlySignal } from '@preact/signals';
import { useOptimistic, type OptimisticHandle } from '../optimistic.js';

function _probes() {
  const [value, addOptimistic] = useOptimistic<number[], string>(
    [1, 2, 3],
    (current, _payload) => [...current, current.length]
  );
  expectTypeOf(value).toEqualTypeOf<ReadonlySignal<number[]>>();
  expectTypeOf(value.value).toEqualTypeOf<number[]>();
  expectTypeOf(addOptimistic).toEqualTypeOf<
    (payload: string) => OptimisticHandle
  >();

  const handle = addOptimistic('x');
  expectTypeOf(handle).toEqualTypeOf<OptimisticHandle>();
}

void _probes;
