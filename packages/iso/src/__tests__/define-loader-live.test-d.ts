// Type-level enforcement of the live/non-live `.View` discriminant. Run under
// `pnpm test:types`. `defineLoader({ live: true })` returns a `LoaderRef<T, true>`
// that exposes ONLY the accumulating `.View` form (no single-value `.View`, no
// `useData`, no `Boundary`); a non-live loader exposes ONLY the single-value
// form. Misusing the wrong form is a compile error, which is why there is no
// runtime guard for the non-live + accumulate case (the client `serverLoaders`
// stub does not carry `live`, so a runtime `!live` check is impossible there).
import { expectTypeOf } from 'vitest';
import {
  defineLoader,
  type LoaderRef,
  type LoaderState,
} from '../define-loader.js';

async function* gen(): AsyncGenerator<number, void, unknown> {
  yield 1;
}

// A live loader: accumulating form only.
function _liveProbes() {
  const live = defineLoader<number>(gen, { live: true });

  // The accumulating form type-checks; the render arg is the `StreamState<Acc>`
  // union, whose data-carrying arms expose the caller's Acc.
  live.View<number[]>(
    (s) => {
      expectTypeOf(s.status).toEqualTypeOf<
        'connecting' | 'open' | 'closed' | 'error'
      >();
      if (s.status === 'open' || s.status === 'closed') {
        expectTypeOf(s.data).toEqualTypeOf<number[]>();
      }
      return null;
    },
    { initial: [], reduce: (acc) => acc }
  );

  // @ts-expect-error the single-value `.View(render)` form is not available on a live loader
  live.View(() => null);

  // A live loader has no single value: `useData` and `Boundary` are `never`.
  expectTypeOf(live.useData).toBeNever();
  expectTypeOf(live.Boundary).toBeNever();
}

// A non-live loader: single-value form only.
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

  // @ts-expect-error the accumulating `{ initial, reduce }` form is not available on a non-live loader
  stat.View(() => null, { initial: [] as number[], reduce: (acc) => acc });

  // The single-value affordances are present; useData() is the discriminated state.
  expectTypeOf(stat.useData()).toEqualTypeOf<LoaderState<{ at: string }>>();
}

// A bare `LoaderRef<T>` defaults to the non-live (single-value) form, so its
// `.View` is callable directly (the common case, and what quick-start documents).
// Code that must accept either liveness uses `LoaderRef<T, boolean>` instead.
function _defaultRefProbes(loader: LoaderRef<{ n: number }>) {
  loader.View((s) => {
    if (s.status === 'success' || s.status === 'revalidating') {
      expectTypeOf(s.data).toEqualTypeOf<{ n: number }>();
    }
    return null;
  });
  expectTypeOf(loader.useData()).toEqualTypeOf<LoaderState<{ n: number }>>();
}

void _liveProbes;
void _staticProbes;
void _defaultRefProbes;
