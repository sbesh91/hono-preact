import { expectTypeOf } from 'vitest';
import { defineLoader } from '../define-loader.js';
import type { DefineLoaderOpts, LoaderRef } from '../define-loader.js';

// The option is an optional number.
expectTypeOf<DefineLoaderOpts<number>['fallbackDelay']>().toEqualTypeOf<
  number | undefined
>();

// The ref surfaces it as number | undefined.
expectTypeOf<LoaderRef<number>['fallbackDelay']>().toEqualTypeOf<
  number | undefined
>();

// defineLoader accepts it at the call site.
const ref = defineLoader(async () => 1, { fallbackDelay: 100 });
expectTypeOf(ref.fallbackDelay).toEqualTypeOf<number | undefined>();
