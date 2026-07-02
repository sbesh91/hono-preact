import { expectTypeOf } from 'vitest';
import type { NavigateOptions } from '../use-navigate.js';
import type { NavLinkProps } from '../nav-link.js';

expectTypeOf<NavigateOptions['transition']>().toEqualTypeOf<
  boolean | undefined
>();

expectTypeOf<NavLinkProps['transition']>().toEqualTypeOf<boolean | undefined>();
