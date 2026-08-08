// `sameLoaderData` in `loader-data-provider.tsx` decides whether two arms are
// equivalent by comparing `status`, `data` and `error`. That is exhaustive over
// today's union, and nothing enforced that it stays so: adding a field to any
// arm would leave the comparator silently blind to it, and a change in that
// field would then NOT publish, which is a stale view rather than an extra
// render. The failure is worse than the one the boundary was built to fix.
//
// This is a type-level gate. Add a field to any `LoaderState` / `StreamState`
// arm and this stops compiling until `sameLoaderData` accounts for it.
import type { LoaderState, StreamState } from '../../loader-state.js';

/** Distributive `keyof`: the union of keys across ALL arms, not the shared few
 * a bare `keyof` on a union would give. */
type ArmKeys<T> = T extends unknown ? keyof T : never;

/** Exactly the fields `sameLoaderData` reads. */
type ComparedKeys = 'status' | 'data' | 'error';

type EveryFieldIsCompared =
  | ArmKeys<LoaderState<unknown>>
  | ArmKeys<StreamState<unknown>> extends ComparedKeys
  ? true
  : never;

// Fails to compile the moment an arm carries a field the comparator ignores.
export const _everyFieldIsCompared: EveryFieldIsCompared = true;

// Mutation check for the gate itself: if `ComparedKeys` were narrowed, the
// assertion above must break. Proves this file is not vacuously true.
type NarrowedOnPurpose = 'status';
type ShouldFail =
  ArmKeys<LoaderState<unknown>> extends NarrowedOnPurpose ? true : never;
// @ts-expect-error `data` and `error` are not in `NarrowedOnPurpose`
export const _gateIsNotVacuous: ShouldFail = true;
