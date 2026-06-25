// `fallbackDelay` has been removed from the public API. This file asserts
// that neither DefineLoaderOptions nor LoaderRef carry the option, and that
// defineLoader rejects it at the call site.
import { expectTypeOf } from 'vitest';
import { defineLoader } from '../define-loader.js';
import type { DefineLoaderOptions, LoaderRef } from '../define-loader.js';

// DefineLoaderOptions does NOT include fallbackDelay.
expectTypeOf<DefineLoaderOptions<number>>().not.toHaveProperty('fallbackDelay');

// LoaderRef does NOT surface fallbackDelay.
expectTypeOf<LoaderRef<number>>().not.toHaveProperty('fallbackDelay');

// defineLoader rejects fallbackDelay at the call site.
// @ts-expect-error fallbackDelay is no longer accepted
defineLoader(async () => 1, { fallbackDelay: 100 });
