import type { ServerMiddleware, Scope } from './define-middleware.js';
import type { StreamObserver } from './define-stream-observer.js';

// App-level `use` is the outermost layer of EVERY server chain, not just the
// page one: `render.tsx` dispatches it with a `ServerPageCtx`, and
// `composeServerChain` folds the same array into the loader and action chains,
// where the handlers dispatch it with a `ServerLoaderCtx` / `ServerActionCtx`.
// That is what "app-level" means, and narrowing the dispatch instead would drop
// an app-tier guard off the loader and action paths. So an entry here has to
// handle all three scopes: `ServerMiddleware` (i.e. `ServerMiddleware<Scope>`,
// the ctx union) is the only server shape that does. A single-scope
// `defineServerMiddleware<'page'>(...)` / `<'loader'>(...)` / `<'action'>(...)`
// is rejected, because the two scopes it did not sign up for are exactly the
// ones where its ctx reads (`ctx.location` on the bare-action path, `ctx.module`
// / `ctx.loader` on the page path) are absent.
//
// No `ClientMiddleware` arm: app config never enters the client module graph
// (the generated client entry imports only routes; `bootClient()` takes no
// config), so an app-level client middleware would typecheck and then never
// run. Client middleware belongs on route nodes, whose `use` the client
// dispatcher does see (#359).
export type AppUseElement =
  | ServerMiddleware<Scope>
  | StreamObserver<unknown, never>;

export type AppConfig = {
  use?: ReadonlyArray<AppUseElement>;
  /**
   * When `true`, the server emits a `<script type="speculationrules">` tag
   * into `<head>` that instructs supporting browsers to prefetch same-origin
   * `<a href>` links on moderate eagerness. Defaults to `false`. Individual
   * links opt out with `data-no-prefetch`.
   */
  speculation?: boolean;
  /**
   * Font URLs (from `?url` imports) to preload as render-critical resources.
   * List only above-the-fold weights: preloading every font wastes early
   * bandwidth. Each URL is emitted as `<link rel="preload" as="font"
   * crossorigin>` in the head and in the `Link` response header.
   */
  fonts?: ReadonlyArray<string>;
};

export function defineApp(config: AppConfig): AppConfig {
  return config;
}
