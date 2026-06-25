import { expectTypeOf } from 'vitest';
import type { LoaderState, StreamState } from '../loader-state.js';

// `data` is narrowed to T in value arms; no `| undefined`.
declare const s: LoaderState<{ title: string }>;
if (s.status === 'success') expectTypeOf(s.data).toEqualTypeOf<{ title: string }>();
if (s.status === 'loading') expectTypeOf<keyof typeof s>().toEqualTypeOf<'status'>();

declare const ss: StreamState<number[]>;
if (ss.status === 'open') expectTypeOf(ss.data).toEqualTypeOf<number[]>();
if (ss.status === 'connecting') expectTypeOf<keyof typeof ss>().toEqualTypeOf<'status'>();
