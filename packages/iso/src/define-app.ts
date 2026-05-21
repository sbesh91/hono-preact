import type {
  ServerMiddleware,
  ClientMiddleware,
} from './define-middleware.js';
import type { StreamObserver } from './define-stream-observer.js';

// App-level `use` runs in page scope (see `render.tsx`'s root dispatch),
// so only page-scope server middleware is allowed. `ServerMiddleware<Scope>`
// looks innocuous but distributes over the `Scope` union and would let a
// `defineServerMiddleware<'loader'>(...)` or `<'action'>(...)` slip in;
// the dispatcher would then call it with a `ServerPageCtx` and the
// `ctx.module` / `ctx.loader` reads would be undefined. List the legal
// shapes explicitly to keep the type honest.
export type AppUseElement =
  | ServerMiddleware<'page'>
  | ClientMiddleware
  | StreamObserver<unknown, never>;

export type AppConfig = {
  use?: ReadonlyArray<AppUseElement>;
};

export function defineApp(config: AppConfig): AppConfig {
  return config;
}
