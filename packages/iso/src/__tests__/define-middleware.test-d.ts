// Type-level guards for the server middleware surface, run via
// `pnpm test:types` (`vitest --typecheck.only`). Only `*.test-d.*` files are
// typechecked by that command, so these assertions are the ones that hold the
// build accountable for the variance rules below.
import { expectTypeOf } from 'vitest';
import {
  defineServerMiddleware,
  type ServerMiddleware,
  type ServerCtx,
  type ServerPageCtx,
  type ServerLoaderCtx,
  type ServerActionCtx,
  type Scope,
} from '../define-middleware.js';
import type { AppUseElement } from '../define-app.js';

// `ServerCtx<Scope>` is the union of the three scope contexts: what an
// all-scope middleware has to accept.
expectTypeOf<ServerCtx<Scope>>().toEqualTypeOf<
  ServerPageCtx | ServerLoaderCtx | ServerActionCtx
>();
expectTypeOf<ServerCtx<'page'>>().toEqualTypeOf<ServerPageCtx>();
expectTypeOf<ServerCtx<'loader'>>().toEqualTypeOf<ServerLoaderCtx>();
expectTypeOf<ServerCtx<'action'>>().toEqualTypeOf<ServerActionCtx>();

declare const pageMw: ServerMiddleware<'page'>;
declare const loaderMw: ServerMiddleware<'loader'>;
declare const actionMw: ServerMiddleware<'action'>;
declare const allMw: ServerMiddleware<Scope>;

// `S` is CONTRAVARIANT: the `fn` parameter is the only place it appears. An
// all-scope middleware satisfies any single-scope slot...
expectTypeOf(allMw).toExtend<ServerMiddleware<'page'>>();
expectTypeOf(allMw).toExtend<ServerMiddleware<'loader'>>();
expectTypeOf(allMw).toExtend<ServerMiddleware<'action'>>();

// ...and no single-scope middleware satisfies the all-scope slot. This is what
// `AppConfig['use']` leans on: the app tier is dispatched in all three scopes,
// so an entry that signed up for one of them is not safe there.
const appUse: AppUseElement[] = [allMw];
void appUse;

// @ts-expect-error page-only middleware cannot be app-level: the loader and
// action dispatches would hand it a ctx it did not sign up for.
const rejectPage: AppUseElement = pageMw;
// @ts-expect-error loader-only middleware cannot be app-level: the page
// dispatch would hand it a ServerPageCtx with no `module` / `loader`.
const rejectLoader: AppUseElement = loaderMw;
// @ts-expect-error action-only middleware cannot be app-level.
const rejectAction: AppUseElement = actionMw;
void rejectPage;
void rejectLoader;
void rejectAction;

// `next()` resolves with no value, so BOTH spellings the dispatcher's
// contract-violation message prescribes typecheck: `await next()` and the
// pass-through `return next()`.
const awaited = defineServerMiddleware(async (_ctx, next) => {
  await next();
});
const returned = defineServerMiddleware(async (_ctx, next) => next());
expectTypeOf(awaited).toEqualTypeOf<ServerMiddleware<Scope>>();
expectTypeOf(returned).toEqualTypeOf<ServerMiddleware<Scope>>();

// An un-annotated `defineServerMiddleware(...)` infers the all-scope form, so
// the default spelling is the one that fits an app-level `use`.
expectTypeOf(awaited).toExtend<AppUseElement>();
