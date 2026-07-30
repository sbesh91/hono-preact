// Type-level enforcement of the streaming/single-value `.View` discriminant.
// Run under `pnpm test:types`. The discriminant is driven by the fn return type:
// an AsyncGenerator fn produces `LoaderRef<T, true>` (accumulating `.View`,
// `useData(initial, reduce)`; `Boundary` still `never`); a Promise fn produces
// `LoaderRef<T, false>` (single-value `.View`, `useData()`, `Boundary`).
// `{ live: true }` is a runtime SSR flag only; it no longer controls the type
// discriminant. Misusing the wrong form is a compile error.
import { expectTypeOf } from 'vitest';
import type { ReadonlySignal } from '@preact/signals';
import {
  defineLoader,
  type LoaderRef,
  type LoaderState,
  type StreamState,
} from '../define-loader.js';

async function* gen(): AsyncGenerator<number, void, unknown> {
  yield 1;
}

// A streaming loader (generator fn): accumulating form only.
// `{ live: true }` adds the SSR opt-out; the type discriminant comes from `gen`.
function _liveProbes() {
  const live = defineLoader<number>(gen, { live: true });

  // The accumulating form type-checks; the render arg is the `StreamState<Acc>`
  // union, whose data-carrying arms expose the caller's Acc.
  live.View<number[]>(
    (s) => {
      // Pins the PUBLIC status vocabulary. `reconnecting` was added for a
      // resubscribe over already-delivered chunks (#349 R4/R5); it belongs here
      // because this assertion is what makes such an addition a deliberate,
      // reviewed change to the surface rather than a silent one.
      expectTypeOf(s.status).toEqualTypeOf<
        'connecting' | 'open' | 'closed' | 'reconnecting' | 'error'
      >();
      // `reconnecting` is data-bearing, like `open` / `closed`.
      if (
        s.status === 'open' ||
        s.status === 'closed' ||
        s.status === 'reconnecting'
      ) {
        expectTypeOf(s.data).toEqualTypeOf<number[]>();
      }
      return null;
    },
    { initial: [], reduce: (acc) => acc }
  );

  // @ts-expect-error the single-value `.View(render)` form is not available on a live loader
  live.View(() => null);

  // The live arm of `useData` requires `(initial, reduce)`; `Acc` is inferred
  // from both, and the return type is `ReadonlySignal<StreamState<Acc>>` (the
  // same shape `.View`'s accumulating render fn receives, wrapped in a signal).
  const total = live.useData(0, (acc, n) => acc + n);
  expectTypeOf(total).toEqualTypeOf<ReadonlySignal<StreamState<number>>>();

  // @ts-expect-error a live loader's `useData` requires (initial, reduce); calling it with no args is a type error
  live.useData();

  // A live loader's `Boundary` is a collect-mode host (children fold via
  // `useData(initial, reduce)`); it is no longer `never`.
  expectTypeOf(live.Boundary).not.toBeNever();
}

// A single-value loader (Promise fn): single-value form only.
function _staticProbes() {
  const stat = defineLoader<{ at: Date }>(async () => ({ at: new Date() }));

  // The single-value form type-checks; the render arg is the discriminated
  // `LoaderState<Serialize<T>>`, whose data arms expose the wire shape.
  stat.View((s) => {
    if (s.status === 'success' || s.status === 'revalidating') {
      expectTypeOf(s.data).toEqualTypeOf<{ at: string }>();
    }
    return null;
  });

  // @ts-expect-error the accumulating `{ initial, reduce }` form is not available on a single-value loader
  stat.View(() => null, { initial: [] as number[], reduce: (acc) => acc });

  // The single-value affordances are present; useData() returns a reactive
  // signal of the discriminated state (pattern-match `.value.status`).
  expectTypeOf(stat.useData()).toEqualTypeOf<
    ReadonlySignal<LoaderState<{ at: string }>>
  >();
}

// A bare `LoaderRef<T>` defaults to the single-value form (Live=false), so its
// `.View` is callable directly (the common case, and what quick-start documents).
// Code that must accept either form uses `LoaderRef<T, boolean>` instead.
function _defaultRefProbes(loader: LoaderRef<{ n: number }>) {
  loader.View((s) => {
    if (s.status === 'success' || s.status === 'revalidating') {
      expectTypeOf(s.data).toEqualTypeOf<{ n: number }>();
    }
    return null;
  });
  expectTypeOf(loader.useData()).toEqualTypeOf<
    ReadonlySignal<LoaderState<{ n: number }>>
  >();
}

void _liveProbes;
void _staticProbes;
void _defaultRefProbes;
