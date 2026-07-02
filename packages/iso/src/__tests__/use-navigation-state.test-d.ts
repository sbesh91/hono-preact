import { expectTypeOf } from 'vitest';
import {
  useNavigationState,
  type NavigationState,
} from '../use-navigation-state.js';

expectTypeOf<NavigationState['pending']>().toEqualTypeOf<boolean>();
expectTypeOf(useNavigationState).returns.toEqualTypeOf<NavigationState>();
expectTypeOf(useNavigationState)
  .parameter(0)
  .toEqualTypeOf<{ delayMs?: number } | undefined>();
