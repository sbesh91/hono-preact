import { expectTypeOf } from 'vitest';
import type { NavigateOptions } from '../use-navigate.js';
import type { NavLinkProps } from '../nav-link.js';
import { skipNextNavTransition } from '../internal/route-change.js';

expectTypeOf<NavigateOptions['transition']>().toEqualTypeOf<
  boolean | undefined
>();

expectTypeOf<NavLinkProps['transition']>().toEqualTypeOf<boolean | undefined>();

expectTypeOf(skipNextNavTransition).toBeCallableWith();
expectTypeOf(skipNextNavTransition).toBeCallableWith('/inbox?folder=archive');
expectTypeOf(skipNextNavTransition).returns.toEqualTypeOf<void>();
