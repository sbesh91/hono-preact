// Type-level assertions for `match`. Plain `.ts`, NOT `.test-d.ts`: the latter
// is excluded from tsconfig.test.json and would pass vacuously under tsc.
import { match } from '../loader-state.js';
import type { LoaderState, StreamState } from '../loader-state.js';

declare const single: LoaderState<number>;
declare const stream: StreamState<number[]>;

// Each handler receives its narrowed member.
const a: string = match(single, {
  loading: (s) => {
    // The cold arm's `data` is `data?: never`, so reading it is legal and
    // yields `undefined`; what must fail is treating it as a VALUE. Do not
    // write `@ts-expect-error void s.data` here: that directive is unused and
    // tsc fails with TS2578.
    // @ts-expect-error the cold `loading` arm carries no value
    const v: number = s.data;
    void v;
    return 'loading';
  },
  success: (s) => `${s.data}`,
  revalidating: (s) => `${s.data}`,
  error: (s) => s.error.message,
});
void a;

// Streaming arms work through the same helper.
const b: number = match(stream, {
  connecting: () => 0,
  open: (s) => s.data.length,
  reconnecting: (s) => s.data.length,
  closed: (s) => s.data.length,
  error: () => -1,
});
void b;

// A missing arm is a compile error without `_`.
// @ts-expect-error missing the `error` arm and no `_` fallback
const c: string = match(single, {
  loading: () => 'l',
  success: (s) => `${s.data}`,
  revalidating: (s) => `${s.data}`,
});
void c;

// The `_` overload permits a partial map.
const d: string = match(stream, {
  open: (s) => `${s.data.length}`,
  _: (s) => s.status,
});
void d;

// A widened `status` (plain `string`, not a literal union) cannot use the
// exhaustive overload: there is no finite arm set to be exhaustive over, so a
// one-arm map would otherwise satisfy a bare index signature and the runtime
// would throw on any other status.
declare const widened: { status: string; data?: unknown };
// @ts-expect-error a non-literal `status` has no exhaustive form
const e: string = match(widened, { success: () => 'ok' });
void e;

// The same value is fine once `_` supplies the catch-all.
const f: string = match(widened, {
  success: () => 'ok',
  _: (s) => s.status,
});
void f;
