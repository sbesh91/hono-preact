# Remix v3 vs `@hono-preact/iso`

**Date:** 2026-05-01
**Source:** `https://api.remix.run/` (Remix v3.0.0-beta.0), per-symbol markdown alternates.

---

## TL;DR

| Axis | Remix v3 | `@hono-preact/iso` |
|---|---|---|
| Author primitive | HTTP handler `(ctx) => Response` | Page = `.tsx` + `.server.ts` pair |
| Routing | `router.get/post/...`, `route()`, `form()`, `resource()` | `<Route path component>` JSX |
| Data into the view | Handler passes data as props | `useLoaderData<typeof loader>()` |
| Hydration | Islands via `clientEntry`, sub-trees via `Frame` | Whole-app hydration, loader data inlined |
| Cross-cutting | Koa-style middleware writes typed entries to `RequestContext` | Per-page `serverGuards`/`clientGuards` slots |
| Server/client split | Convention + bundler tree-shake | Vite plugins rewrite/validate `.server.*` files |
| View runtime | Custom VDOM, factory components, `handle.update()` | Preact + hooks + Suspense |
| Pattern matching | protocol/host/port/pathname/search | pathname + searchParams |
| Body / sessions / files | First-class packages | Defers to Hono |

Both: Web `Request`/`Response`, server-only code stripped from client, server fn callable as RPC during nav.

---

## 1. Remix v3

### 1.1 Routing core

The unit is the **HTTP handler**, not a page. `createRouter()` returns a `Router` exposing verb methods, with `route`/`map` for tree-shaped registration and `form()`/`resource()`/`resources()` as conventions.

```ts
function createRouter<C, M extends readonly AnyMiddleware[]>(
  options?: RouterOptions<C, M>,
): Router<ApplyMiddlewareTuple<C, M>>;

interface Router<C> {
  get: VerbMethod<"GET", C>;
  post: VerbMethod<"POST", C>;
  put: VerbMethod<"PUT", C>;
  patch: VerbMethod<"PATCH", C>;
  delete: VerbMethod<"DELETE", C>;
  head: VerbMethod<"HEAD", C>;
  options: VerbMethod<"OPTIONS", C>;
  route: RouteMethod<C>;
  map: MapMethod<C>;
  fetch(input: string | URL | Request, init: RequestInit): Promise<Response>;
}
```

Single entry point: `router.fetch(request) -> Response`.

### 1.2 Request handling

A handler is `(context: RequestContext) => Response | Promise<Response>`. **There is no built-in data hook.** Handlers fetch what they need, then return a response, typically:

```ts
return createHtmlResponse(renderToStream(<App data={data} />));
```

Components receive data **as props**, full stop.

Node integration:

```ts
http.createServer(createRequestListener(router.fetch, { onError })).listen(3000);
```

### 1.3 Middleware and `RequestContext`

Koa-style chain. `RequestContext` is one mutable bag passed through middleware and the final handler.

```ts
interface Middleware {
  (ctx: RequestContext, next: NextFunction):
    | void | Response | Promise<void | Response | undefined>;
}
type NextFunction = () => Promise<Response>;
```

Middleware contributes typed entries via `createContextKey`. Built-ins:

- `auth()` writes `Auth`
- `session()` writes `Session`
- `formData()` writes `FormData`
- `methodOverride()` lets HTML forms simulate PUT/DELETE
- `requireAuth()` is a downstream gate

The middleware tuple is preserved at the type level, so `context.get(Key)` is fully inferred end-to-end.

### 1.4 Route patterns

`@remix-run/route-pattern` matches **protocol + hostname + port + pathname + search**, not just pathname.

- Two matcher impls: `ArrayMatcher`, `TrieMatcher`
- `RouterOptions.matcher` is pluggable
- `pattern.href(args)` builds URLs from the same source

### 1.5 View layer

`@remix-run/ui` is a custom VDOM, not React. A component is a factory:

```ts
(handle: Handle<Props>) => RenderFn
```

The handle is a stable per-instance object:

- `props` (mutated in place across renders)
- `context`
- `signal` (aborts on unmount)
- `update()` to schedule re-render

No hooks, no per-render closures. Closer to Solid or Stencil than React.

### 1.6 Hydration

**Island-based.** `clientEntry('/js/counter.js#Counter', Counter)` marks a component as needing JS on the client, with an explicit module URL as its identity.

- `renderToStream(node, { resolveClientEntry, resolveFrame })` emits HTML plus markers
- Client `run({ loadModule, resolveFrame })` resolves and hydrates each island
- `<Frame src="/path">` is a navigable subtree fetched from another URL
- `navigate(href)` drives client-side transitions through the Navigation API

### 1.7 Mutations

Conventional: POST to a URL, return a `Response`.

- `form(pattern)` generates the `(GET index, POST action)` pair at one URL
- `parseFormData(request, opts, uploadHandler)` is the body parser
- Bounded-resource error types: `MaxFileSizeExceededError`, `MaxFilesExceededError`, etc.
- `formData()` middleware writes the parsed `FormData` to context

### 1.8 Sessions

```ts
class Session<V, F> {
  get/set/has/unset(key)
  flash(key, value)        // available only on next request
  destroy()
  regenerateId(deleteOld)  // call after login
  dirty / destroyed / deleteId
}

interface SessionStorage {
  read(cookie: string | null): Promise<Session<Data, Data>>;
  save(session: Session): Promise<string | null>;
}
```

Backends: cookie, memory, fs, redis, memcache.

### 1.9 Response helpers

- `createHtmlResponse`
- `redirect` / `createRedirectResponse`
- `createFileResponse` (conditional GET, ranges, ETags)
- `compressResponse` (auto-skips already-compressed/range/no-transform; weakens strong ETags per RFC 7232)

---

## 2. `@hono-preact/iso`

### 2.1 The page primitive

Each route is a pair: `movies.tsx` + `movies.server.ts`.

```ts
// movies.server.ts
const serverLoader = async () => ({ movies: await getMovies() });
export default serverLoader;
export const loader = defineLoader('movies', serverLoader);

// movies.tsx
function Movies() {
  const { movies } = useLoaderData<typeof loader>();
  return <ul>{movies.map(m => <li key={m.id}>{m.title}</li>)}</ul>;
}
export default definePage(Movies, { loader });
```

`definePage` stamps bindings (`loader`, `cache?`, `Wrapper?`) onto the component via a `Symbol.for`-keyed property.

### 2.2 Routing

Explicit JSX in `iso.tsx`:

```tsx
<Router>
  <Route path="/movies" component={Movies} />
  <Route path="/watched" component={Watched} fallback={<p>Loading…</p>} />
</Router>
```

- Pathname + searchParams matching only
- No nested route tree; per-page layout via the optional `Wrapper` binding
- Code-splitting opt-in via `lazy()` per `<Route>`

### 2.3 Data flow

| Phase | Behavior |
|---|---|
| SSR | `<Page>` invokes the loader directly, inlines result into HTML |
| Hydration | `getPreloadedData(id)` returns inlined data, no network round-trip |
| Client nav | `serverOnlyPlugin` rewrites the loader call to an RPC against the same server fn |

One author-side loader, three environments. `useLoaderData<typeof loader>()` reads from `LoaderDataContext`.

### 2.4 Server/client split

Two Vite plugins enforce the boundary:

**`serverOnlyPlugin`** rewrites `*.server.*` imports in the client bundle:

- default → RPC fn
- `loader` → client-safe `LoaderRef`
- `cache` → `cacheRegistry`-deduped client cache
- `serverGuards` / `actionGuards` → `[]`
- `serverActions` → `Proxy`
- side-effect-only `.server.*` imports stripped

**`serverLoaderValidationPlugin`** enforces an export allowlist on `.server.*` files:

- Allowed: `loader`, `cache`, `serverGuards`, `serverActions`, `actionGuards`
- Re-exports from `.server.*` modules are banned at build time

### 2.5 Mutations

- `defineAction` + `<Form>` + `useAction` for typed action calls
- `useOptimistic` / `useOptimisticAction` / `<OptimisticOverlay>` for optimistic UI
- Revalidation is **manual** via `useReload()` from `ReloadContext`

### 2.6 Auth and access control

First-class per-route slots:

- `serverGuards` / `clientGuards` run before the loader
- `GuardRedirect` thrown to redirect
- `<Guards>` / `<GuardGate>` / `useGuardResult` consume guard output in the tree
- Action-level guards via `actionGuards` and `defineActionGuard`

### 2.7 In-flight state

- `<Loader>` self-suspends through `wrapPromise`
- `ReloadContext` exposes `{ reload, reloading, error }`
- Reader is reused across re-renders so a `setReloading` doesn't fire a duplicate XHR or wipe optimistic state

### 2.8 Stack

Preact + `preact-iso` (router, Suspense, lazy) + Hono on the server.

---

## 3. Differences

### 3.1 Center of gravity

- **v3:** the router and the `Request -> Response` function. The component layer is one of several things a handler may return.
- **iso:** the page. Component, loader, action, guards co-located via bindings; the router maps paths to pages.

### 3.2 Data hook

- **v3:** none. Handlers wire data into props.
- **iso:** `useLoaderData<typeof loader>()` with type inference and built-in SSR-to-client preload.

### 3.3 Hydration model

- **v3:** islands. Each `clientEntry` is an explicit hydration boundary identified by module URL. `Frame` fetches sub-trees from other URLs.
- **iso:** whole-app hydration. Per-page loader data inlined into the document. Sub-fetching during nav is the framework calling the loader RPC.

### 3.4 Page composition

- **v3:** `Frame src` (sub-tree comes from another route's response).
- **iso:** `Wrapper` binding. Cross-page composition is whatever the wrapper renders.

### 3.5 Server boundary enforcement

- **v3:** convention + bundler tree-shake. `clientEntry`/island markers explicitly opt code into the client.
- **iso:** file-suffix plus two Vite plugins (rewrite + validate).

### 3.6 Auth / authorization

- **v3:** middleware writing `Auth`/`Session` to typed `RequestContext`, plus `requireAuth()` gate.
- **iso:** per-page `serverGuards`/`clientGuards` slots, `GuardRedirect`, `GuardResultContext`.

### 3.7 Cross-cutting concerns

- **v3:** general middleware chain. Logging, CORS, CSRF, compression, body parsing, method override are all middlewares contributing types to `RequestContext`.
- **iso:** no general middleware. Cross-cutting work lives in Hono on the server, page bindings on the client.

### 3.8 Route pattern scope

- **v3:** protocol/host/port/pathname/search, pluggable matcher.
- **iso:** pathname + searchParams via `preact-iso`.

### 3.9 Route shorthands

- **v3:** `form()`, `resource()`, `resources()` as Rails-style helpers generating verb-route maps.
- **iso:** none. Routes declared one at a time.

### 3.10 Mutation flow

- **v3:** POST handler returns `Response` (often a redirect). Body parsing via `formData()` middleware. Revalidation is automatic if the redirect triggers a new GET.
- **iso:** `defineAction` + `<Form>` + `useAction` returns typed results. Optimistic primitives baked in. Revalidation is manual via `useReload()`.

### 3.11 View layer

- **v3:** custom VDOM, factory components, no hooks, explicit `handle.update()`.
- **iso:** Preact + hooks + Suspense.

### 3.12 Body parsing, sessions, file responses

- **v3:** typed packages (`parseFormData` with bounded errors, `Session` with multiple storages, `createFileResponse` with conditional GET/ranges/ETags).
- **iso:** defers to Hono.

---

## 4. Where they meet

- Web `Request`/`Response` everywhere
- Server-only code stripped from the client bundle
- Server function callable as RPC during nav
- Fetch-based runtime, no virtual server

The largest divergence is the **author-side primitive**:

- v3 makes you write a **handler** and decide whether/how to use the UI layer
- iso makes you write a **page** and the framework wires SSR/hydration/RPC for the loader automatically

---

## 5. Reference

### 5.1 Remix v3 packages

**Routing & runtime**

```
remix/fetch-router            remix/fetch-router/routes
remix/route-pattern           remix/node-fetch-server
remix/node-serve              remix/cli
```

**Middleware**

```
remix/async-context-middleware  remix/auth-middleware
remix/compression-middleware    remix/cop-middleware
remix/cors-middleware           remix/csrf-middleware
remix/form-data-middleware      remix/logger-middleware
remix/method-override-middleware remix/session-middleware
remix/static-middleware
```

**HTTP / IO**

```
remix/response          remix/headers          remix/cookie
remix/file-storage      remix/file-storage-s3  remix/fs
remix/lazy-file         remix/mime             remix/multipart-parser
remix/form-data-parser  remix/tar-parser       remix/html-template
```

**Sessions**

```
remix/session                       remix/session-storage-redis
remix/session-storage-memcache
```

**Data**

```
remix/data-schema   remix/data-table
remix/data-table-{mysql,postgres,sqlite}
```

**UI**

```
remix/ui            remix/ui/server     remix/ui/jsx-runtime
remix/ui/{accordion, anchor, animation, breadcrumbs, button,
          combobox, glyph, listbox, menu, popover, select, theme}
```

**Misc**

```
remix/auth   remix/assert   remix/assets   remix/test   remix/terminal
```

### 5.2 Captured signatures

```ts
// fetch-router
function createRouter<C extends AnyContext>(): Router<C>;
function createRouter<C, M extends readonly AnyMiddleware[]>(
  options: RouterOptions<C, M>,
): Router<ApplyMiddlewareTuple<C, M>>;

class RequestContext<P, E> {
  headers: Headers;
  method: RequestMethod;
  params: P;
  request: Request;
  url: URL;
  get<K>(key: K): ResolveContextEntryValue<E, K>;
  has<K>(key: K): boolean;
  set<K>(key: K, value: ContextValue<K>): void;
}

interface Middleware {
  (ctx: RequestContext, next: NextFunction):
    | void | Response | Promise<void | Response | undefined>;
}
type NextFunction = () => Promise<Response>;

// route definitions
function createRoutes(base?, defs): RouteMap;
function form(pattern, options?: FormOptions): { index: GetRoute; action: PostRoute };
function resource(base, options?: ResourceOptions): RouteMap;    // singular CRUD
function resources(base, options?: ResourcesOptions): RouteMap;  // index + CRUD

// node adapter
function createRequestListener(handler: FetchHandler, options): RequestListener;
interface FetchHandler {
  (request: Request, client: ClientAddress): Response | Promise<Response>;
}

// ui (server)
function renderToStream(node: RemixNode, options: RenderToStreamOptions):
  ReadableStream<Uint8Array>;
function renderToString(node: RemixNode): Promise<string>;

// ui (client entry / hydration island)
function clientEntry<P, C>(
  entryId: string,
  component: (handle: Handle<P, C>) => RenderFn,
): EntryComponent<P, C>;

// ui (sub-tree)
interface FrameProps {
  src: string;
  name?: string;
  fallback?: Renderable;
  on?: Record<string, (event: Event, signal: AbortSignal) => void | Promise<void>>;
}
function Frame(handle: Handle<FrameProps, FrameHandle>): () => null;
function navigate(href: string, options: NavigationOptions): Promise<void>;

// response
function createHtmlResponse(body: HtmlBody, init: ResponseInit): Response;
function createRedirectResponse(
  location: string | URL, init?: number | ResponseInit,
): Response;
function createFileResponse<F>(
  file: F, request: Request, options,
): Promise<Response>;
function compressResponse(
  response: Response, request: Request, options,
): Promise<Response>;

// form-data
function parseFormData(
  request, opts: ParseFormDataOptions, uploadHandler?,
): Promise<FormData>;
function formData(options: FormDataOptions): Middleware<...>;

// session
class Session<V, F> {
  get/set/has/unset(key)
  flash(key, value)
  destroy()
  regenerateId(deleteOld: boolean): void
  // dirty, destroyed, deleteId
}
interface SessionStorage {
  read(cookie: string | null): Promise<Session<Data, Data>>;
  save(session: Session): Promise<string | null>;
}

// auth
function auth<S>(options: AuthOptions<S>): Middleware<...>;
function requireAuth<I>(options: RequireAuthOptions): Middleware<...>;
function createSessionAuthScheme<I, V>(options): AuthScheme<I>;
function createBearerTokenAuthScheme<I>(options): AuthScheme<I>;
```
