// Type-level tests for the `Serialize<T>` wire-mirror. Run under
// `pnpm test:types` (`vitest --typecheck.only`); tsc is the oracle. These pin
// the JSON round-trip transform applied at the loader/action client boundary.
import { expectTypeOf } from 'vitest';
import type { Serialize } from '../serialize.js';
import type { LoaderRef } from '../../define-loader.js';
import type { UseActionResult } from '../../action.js';
import type { ActionResult } from '../../use-action-result.js';

// ---------------------------------------------------------------------------
// Primitives pass through unchanged.
// ---------------------------------------------------------------------------
expectTypeOf<Serialize<string>>().toEqualTypeOf<string>();
expectTypeOf<Serialize<number>>().toEqualTypeOf<number>();
expectTypeOf<Serialize<boolean>>().toEqualTypeOf<boolean>();
expectTypeOf<Serialize<null>>().toEqualTypeOf<null>();
expectTypeOf<Serialize<'lit'>>().toEqualTypeOf<'lit'>();

// ---------------------------------------------------------------------------
// toJSON-bearing values serialize as the method's return. Date -> string.
// ---------------------------------------------------------------------------
expectTypeOf<Serialize<Date>>().toEqualTypeOf<string>();
expectTypeOf<Serialize<{ toJSON(): number }>>().toEqualTypeOf<number>();
expectTypeOf<Serialize<{ toJSON(): { n: Date } }>>().toEqualTypeOf<{
  n: string;
}>();

// ---------------------------------------------------------------------------
// Non-serializable whole values collapse to `never` (surfaces as a compile
// error when consumed). bigint actually throws at runtime.
// ---------------------------------------------------------------------------
expectTypeOf<Serialize<bigint>>().toEqualTypeOf<never>();
expectTypeOf<Serialize<symbol>>().toEqualTypeOf<never>();
expectTypeOf<Serialize<() => void>>().toEqualTypeOf<never>();
expectTypeOf<Serialize<undefined>>().toEqualTypeOf<never>();

// ---------------------------------------------------------------------------
// `any` passes through unchanged. Without the up-front `IsAny` guard these
// would recurse forever ("Type instantiation is excessively deep") and turn a
// loader/action returning `any` into a hard compile error at the consumer.
// ---------------------------------------------------------------------------
expectTypeOf<Serialize<any>>().toBeAny();
expectTypeOf<Serialize<any[]>>().toEqualTypeOf<any[]>();
expectTypeOf<Serialize<Record<string, any>>>().not.toBeNever();
// A nested `any` field also terminates (it would otherwise recurse).
expectTypeOf<Serialize<{ data: any }>>().toEqualTypeOf<{ data?: any }>();

// ---------------------------------------------------------------------------
// Objects recurse; Date members become strings; plain shapes are preserved.
// ---------------------------------------------------------------------------
expectTypeOf<Serialize<{ a: string; b: number }>>().toEqualTypeOf<{
  a: string;
  b: number;
}>();
expectTypeOf<Serialize<{ at: Date; nested: { when: Date } }>>().toEqualTypeOf<{
  at: string;
  nested: { when: string };
}>();

// A key whose value cannot serialize is dropped entirely.
expectTypeOf<Serialize<{ a: string; fn: () => void }>>().toEqualTypeOf<{
  a: string;
}>();
expectTypeOf<Serialize<{ a: string; big: bigint }>>().toEqualTypeOf<{
  a: string;
}>();
expectTypeOf<Serialize<{ a: string; bad: undefined }>>().toEqualTypeOf<{
  a: string;
}>();

// An optional property stays optional; a required `T | undefined` becomes
// optional (the key is absent on the wire when undefined).
expectTypeOf<Serialize<{ a?: string }>>().toEqualTypeOf<{ a?: string }>();
expectTypeOf<Serialize<{ a: string | undefined }>>().toEqualTypeOf<{
  a?: string;
}>();
expectTypeOf<Serialize<{ req: string; opt?: number }>>().toEqualTypeOf<{
  req: string;
  opt?: number;
}>();

// ---------------------------------------------------------------------------
// Arrays / tuples recurse element-wise.
// ---------------------------------------------------------------------------
expectTypeOf<Serialize<{ id: number }[]>>().toEqualTypeOf<{ id: number }[]>();
expectTypeOf<Serialize<Date[]>>().toEqualTypeOf<string[]>();
expectTypeOf<Serialize<[string, Date]>>().toEqualTypeOf<[string, string]>();

// A non-serializable array element becomes `null` (JSON.stringify nulls it),
// including the `undefined`/function arm of a union element.
expectTypeOf<Serialize<(string | undefined)[]>>().toEqualTypeOf<
  (string | null)[]
>();
expectTypeOf<Serialize<[string, () => void]>>().toEqualTypeOf<[string, null]>();

// ---------------------------------------------------------------------------
// Map / Set serialize to the empty object.
// ---------------------------------------------------------------------------
expectTypeOf<Serialize<Map<string, number>>>().toEqualTypeOf<
  Record<string, never>
>();
expectTypeOf<Serialize<Set<number>>>().toEqualTypeOf<Record<string, never>>();

// ---------------------------------------------------------------------------
// Deep nesting composes (the common loader-return shape).
// ---------------------------------------------------------------------------
expectTypeOf<
  Serialize<{ items: { id: number; createdAt: Date }[]; total: number }>
>().toEqualTypeOf<{
  items: { id: number; createdAt: string }[];
  total: number;
}>();

// ---------------------------------------------------------------------------
// Boundary wiring: the consumer-facing return types actually APPLY Serialize
// (not just that Serialize<T> works in isolation). A reverted seam fails here.
// ---------------------------------------------------------------------------

// Loader: `useData()` and the `View` render arg expose the wire shape.
expectTypeOf<ReturnType<LoaderRef<{ at: Date }>['useData']>>().toEqualTypeOf<{
  at: string;
}>();

// Action hook: `useAction().data` is `Serialize<TResult> | null`.
expectTypeOf<UseActionResult<unknown, { at: Date }>['data']>().toEqualTypeOf<{
  at: string;
} | null>();

// PE/SSR action result store: the success `data` is the wire shape.
type SuccessResult = Extract<
  ActionResult<unknown, { at: Date }>,
  { kind: 'success' }
>;
expectTypeOf<SuccessResult['data']>().toEqualTypeOf<{ at: string }>();
