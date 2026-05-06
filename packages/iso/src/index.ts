// Page declaration and the <Page> escape hatch.
export { Page } from './page.js';
export type { PageProps, WrapperProps } from './page.js';
export { definePage } from './define-page.js';
export type { PageBindings } from './define-page.js';

// Routing primitives — trivial re-exports of preact-iso. Listed here so
// consumers have a single import surface for everything they need.
export { Route, Router, lazy } from 'preact-iso';

// Server bindings.
export { defineLoader } from './define-loader.js';
export type {
  LoaderRef,
  LoaderCtx,
  Loader as LoaderFn,
} from './define-loader.js';
export { defineAction, useAction } from './action.js';
export type {
  ActionStub,
  UseActionOptions,
  UseActionResult,
  ActionGuardContext,
  ActionGuardFn,
} from './action.js';
export { ActionGuardError, defineActionGuard } from './action.js';

// Hooks.
export { useLoaderData } from './use-loader-data.js';
export { useReload } from './reload-context.js';
export { useOptimistic } from './optimistic.js';
export type { OptimisticHandle } from './optimistic.js';
export { useOptimisticAction } from './optimistic-action.js';
export type {
  UseOptimisticActionOptions,
  UseOptimisticActionResult,
} from './optimistic-action.js';

// Forms.
export { Form } from './form.js';

// Cache + invalidation.
export { createCache } from './cache.js';
export type { LoaderCache } from './cache.js';
export { cacheRegistry } from './cache-registry.js';

// Guards.
export { createGuard, GuardRedirect } from './guard.js';
export type { GuardFn, GuardResult, GuardContext } from './guard.js';

// Utilities.
export { prefetch } from './prefetch.js';
export { isBrowser, env } from './is-browser.js';
