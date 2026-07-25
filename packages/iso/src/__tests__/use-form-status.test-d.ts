// Type-level pin: `useFormStatus` returns a `ReadonlySignal<FormStatus>` (a
// reactive read hook, Phase 3 of the signals migration), not a plain value.
// Run under `pnpm test:types`.
import { expectTypeOf } from 'vitest';
import type { ReadonlySignal } from '@preact/signals';
import { useFormStatus, type FormStatus } from '../use-form-status.js';
import type { ActionRef } from '../action.js';

declare const stub: ActionRef<{ title: string }, { id: number }, never>;

function _probes() {
  const bare = useFormStatus();
  expectTypeOf(bare).toEqualTypeOf<ReadonlySignal<FormStatus>>();

  const typed = useFormStatus(stub);
  expectTypeOf(typed).toEqualTypeOf<ReadonlySignal<FormStatus>>();
  expectTypeOf(typed.value).toEqualTypeOf<FormStatus>();
  expectTypeOf(typed.value.pending).toEqualTypeOf<boolean>();
}

void _probes;
