import { expectTypeOf } from 'vitest';
import type { NavigateOptions } from '../use-navigate.js';

expectTypeOf<NavigateOptions['transition']>().toEqualTypeOf<
  boolean | undefined
>();
