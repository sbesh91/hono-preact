import { expectTypeOf } from 'vitest';
import type { LoaderState, StreamState } from '../loader-state.js';

// The cold `loading` arm carries `data?: never`, so `data` is uniformly
// readable on the bare union as `T | undefined` (no narrow required), while the
// value arms still narrow `data` to `T` with no `| undefined`.
declare const s: LoaderState<{ title: string }>;
expectTypeOf(s.data).toEqualTypeOf<{ title: string } | undefined>();
if (s.status === 'success')
  expectTypeOf(s.data).toEqualTypeOf<{ title: string }>();
if (s.status === 'loading') expectTypeOf(s.data).toEqualTypeOf<undefined>();

// Same for the streaming `connecting` arm.
declare const ss: StreamState<number[]>;
expectTypeOf(ss.data).toEqualTypeOf<number[] | undefined>();
if (ss.status === 'open') expectTypeOf(ss.data).toEqualTypeOf<number[]>();
if (ss.status === 'connecting')
  expectTypeOf(ss.data).toEqualTypeOf<undefined>();
