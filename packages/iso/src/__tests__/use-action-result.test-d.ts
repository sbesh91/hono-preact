// Type-level pin: `useActionResult` returns a `ReadonlySignal<ActionResult<...>>`
// (a reactive read hook, Phase 3 of the signals migration), not a plain value.
// Run under `pnpm test:types`.
import { expectTypeOf } from 'vitest';
import type { ReadonlySignal } from '@preact/signals';
import { useActionResult, type ActionResult } from '../use-action-result.js';
import type { ActionRef } from '../action.js';

declare const stub: ActionRef<{ title: string }, { id: number }, never>;

function _probes() {
  // No stub: TPayload/TResult default to `unknown`.
  const bare = useActionResult();
  expectTypeOf(bare).toEqualTypeOf<
    ReadonlySignal<ActionResult<unknown, unknown>>
  >();

  // With a typed stub: TPayload/TResult are inferred from the ActionRef.
  const typed = useActionResult(stub);
  expectTypeOf(typed).toEqualTypeOf<
    ReadonlySignal<ActionResult<{ title: string }, { id: number }>>
  >();

  // The signal's `.value` is the plain `ActionResult` union (nullable).
  expectTypeOf(typed.value).toEqualTypeOf<
    ActionResult<{ title: string }, { id: number }>
  >();
  if (typed.value?.kind === 'deny') {
    expectTypeOf(typed.value.submittedPayload).toEqualTypeOf<{
      title: string;
    }>();
  }
}

void _probes;
