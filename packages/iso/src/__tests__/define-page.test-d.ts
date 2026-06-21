// Enforced type-level guards for define-page, run via `pnpm test:types`
// (`vitest --typecheck.only`). Migrated from an `expectTypeOf` that previously
// lived in define-page.test.tsx, where it was a runtime no-op: only `*.test-d.*`
// files are typechecked, so a type assertion in a regular `.test` file never
// holds the build accountable.
import { expectTypeOf } from 'vitest';
import type { JSX } from 'preact';
import type { PageBindings } from '../define-page.js';

// A page's `errorFallback` is an element or an `(error, reset)` render function
// (or absent). Pinned exactly so a change to the binding surface fails the build.
expectTypeOf<PageBindings['errorFallback']>().toEqualTypeOf<
  JSX.Element | ((error: Error, reset: () => void) => JSX.Element) | undefined
>();
