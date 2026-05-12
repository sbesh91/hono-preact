# Building an App with Remix v3

**Date:** 2026-05-01
**Source:** `https://api.remix.run/`, package markdown alternates, tag `remix@3.0.0-beta.0`.

This is a self-contained build guide. It's organized by what you do when standing up a new app: bootstrap, route, render, mutate, persist, deploy. Code examples are reproduced from the package docs; type signatures are simplified for readability where the full generic shape is not load-bearing.

---

## 1. Mental model

A Remix v3 app is a single function: `(Request) => Response`. Everything the framework gives you, you compose into that function.

Three layers:

1. **`fetch-router`** is the program. You build a `Router`, mount middleware, register verb handlers per URL, and hand `router.fetch` to a server adapter.
2. **`ui`** is an optional rendering layer. Handlers may use it to produce HTML responses; nothing forces them to.
3. **Standalone packages** (`session`, `auth-middleware`, `data-table`, `assets`, `file-storage`, etc.) plug into the router as middleware or are called directly from handlers.

There is **no file-based routing**, **no `loader`/`action` exports**, and **no in-component data hook**. Routes are declared in code; data goes from handler scope into component props.

---

## 2. Project layout

Remix v3 doesn't enforce a layout. A practical one:

```
my-app/
├── app/
│   ├── server.ts              # entry: builds router, calls serve()
│   ├── routes.ts              # route table (createRoutes)
│   ├── controllers/           # handler implementations
│   │   ├── home.tsx
│   │   ├── users.tsx
│   │   └── auth.tsx
│   ├── components/            # UI components
│   │   ├── App.tsx
│   │   ├── Layout.tsx
│   │   └── client/            # clientEntry'd components
│   ├── db/
│   │   ├── schema.ts          # data-table table() definitions
│   │   └── migrations/
│   ├── session.ts             # session cookie + storage setup
│   └── auth.ts                # auth schemes
├── public/                    # static files
└── package.json
```

The CLI (`remix/cli`) is mentioned in the docs but only exposes `RunRemixOptions`. Project bootstrap is currently bring-your-own; this guide assumes a plain TypeScript project with Node 22+ (for `node:sqlite`).

---

## 3. Server entry

Two transports ship in the box. Pick one.

### Option A: `node-serve` (uWebSockets-based, recommended)

```ts
// app/server.ts
import { serve } from 'remix/node-serve';
import { router } from './router.js';

let server = serve(router.fetch, {
  port: Number(process.env.PORT) || 3000,
  onError(err) { console.error(err); },
});

await server.ready;
console.log(`listening on ${server.port}`);
```

`ServeOptions`:

| Field | Default | Purpose |
|---|---|---|
| `port` | `3000` | TCP port |
| `listenHost` | all interfaces | Bind address |
| `host` | `Host` header | Override `request.url`'s hostname |
| `protocol` | `http:` (or `https:` when `tls` set) | Override `request.url`'s scheme |
| `tls` | none | `{ certFile, keyFile, caFile?, passphrase? }` |
| `onError` | re-throw | Top-level error handler |

### Option B: `node-fetch-server` (Node `http`/`https`)

```ts
import * as http from 'node:http';
import { createRequestListener } from 'remix/node-fetch-server';
import { router } from './router.js';

let server = http.createServer(createRequestListener(router.fetch, {
  onError(err) { console.error(err); },
}));
server.listen(3000);
```

Same `FetchHandler` contract, so the rest of the app is identical. Use this if you need to coexist with other Node HTTP middleware (express compat shims, etc.).

---

## 4. The router

```ts
// app/router.ts
import { createRouter } from 'remix/fetch-router';
import { logger } from 'remix/logger-middleware';
import { compression } from 'remix/compression-middleware';
import { staticFiles } from 'remix/static-middleware';
import { formData } from 'remix/form-data-middleware';
import { methodOverride } from 'remix/method-override-middleware';
import { session } from 'remix/session-middleware';
import { auth } from 'remix/auth-middleware';
import { sessionCookie, sessionStorage } from './session.js';
import { schemes } from './auth.js';

export const router = createRouter({
  middleware: [
    logger({ format: '%method %path %status %duration' }),
    compression(),
    staticFiles('./public', { cacheControl: 'public, max-age=3600' }),
    session(sessionCookie, sessionStorage),
    formData({ maxFileSize: 10 * 1024 * 1024 }),
    methodOverride({}),
    auth({ schemes }),
  ] as const,
});

// register routes after creating
import './routes.js';
```

**Two things matter for typing:**

1. The `middleware: [...]` array must be a tuple (use `as const` or a frozen literal). The `Router`'s context type is computed by walking the tuple, so widening it to `Middleware[]` loses every typed entry.
2. Middleware order matters at runtime. `formData()` must run before `methodOverride()` (which reads a form field). `session()` must run before `csrf()` (which uses the session for the server token). `auth()` must run after whatever produces credentials (session, header).

Per-route middleware can also be attached when registering an action; the action shape accepts a `middleware` tuple alongside the handler.

---

## 5. Routes

Three route registration styles, all compatible.

### 5.1 Verb methods

```ts
// app/routes.ts
import { router } from './router.js';
import * as home from './controllers/home.js';
import * as users from './controllers/users.js';

router.get('/', home.index);
router.get('users/:id', users.show);
router.post('users', users.create);
router.delete('users/:id', users.destroy);
```

Each handler is `(ctx: RequestContext) => Response | Promise<Response>`. Params are typed: in `users/:id`, `ctx.params.id` is `string`.

### 5.2 `route()` / `form()` / `resource()` / `resources()` builders

For tree-shaped registration with `router.map`, the builders construct a typed `RouteMap`.

```ts
import { createRoutes, route, form, resources } from 'remix/fetch-router/routes';

export const routes = createRoutes({
  home:    route('/'),
  signin:  form('/signin'),                 // GET index + POST action
  users:   resources('/users', { param: 'userId' }),  // index/new/show/edit/create/update/destroy
});
```

Then mount with a controller object that mirrors the shape:

```ts
router.map(routes, {
  home: ({ request }) => createHtmlResponse(renderToStream(<Home />)),
  signin: {
    index:  ({ request }) => createHtmlResponse(renderToStream(<SigninForm />)),
    action: signinHandler,
  },
  users: {
    index:   listUsers,
    new:     newUserForm,
    show:    showUser,
    edit:    editUserForm,
    create:  createUser,
    update:  updateUser,
    destroy: destroyUser,
  },
});
```

`form(pattern, options?)` shape:

```ts
form('/signin', {
  formMethod: 'POST',                       // default
  names:      { action: 'action', index: 'index' },
});
```

`resource(base, options?)` is the singular variant (`new/show/create/edit/update/destroy`, no `index`).
`resources(base, options?)` adds `index` and accepts `param` to name the URL segment.

Both accept `only` or `exclude` to subset the generated routes.

### 5.3 Route patterns

Patterns can match more than pathname:

```ts
// pathname only
'users/:id'

// with hostname
'https://api.example.com/users/:id'

// with port
'https://example.com:8080/admin/*path'

// search constraint
'/items?type=book'

// optional segments via {}
'/posts/:year/{:month/{:day}}/:slug'
```

`Params<source>` is computed at the type level; the handler's `ctx.params` is typed to match. `*` is a catchall and is stripped from the typed params (use `ctx.url.pathname` to read it back).

```ts
import { RoutePattern } from 'remix/route-pattern';
let p = new RoutePattern('users/:id');
p.match('/users/42');                       // { params: { id: '42' }, ... }
p.href({ id: 42 });                         // '/users/42'
p.join('https://example.com');              // pattern with hostname prefix
```

---

## 6. RequestContext and middleware

Every handler receives one `RequestContext`. Middleware writes typed entries; downstream code reads them.

```ts
class RequestContext<params, entries> {
  headers: Headers;
  method:  RequestMethod;          // may differ from request.method
  params:  params;
  request: Request;                // may have body consumed
  url:     URL;
  router:  Router;

  get<K>(key: K): ContextValue<K>;
  has<K>(key: K): boolean;
  set<K>(key: K, value: ContextValue<K>): void;
}
```

### Authoring middleware

```ts
import { createContextKey } from 'remix/fetch-router';
import type { Middleware } from 'remix/fetch-router';

export const RequestId = createContextKey<string>('');

export function requestId(): Middleware {
  return async (ctx, next) => {
    ctx.set(RequestId, crypto.randomUUID());
    let response = await next();
    response.headers.set('x-request-id', ctx.get(RequestId));
    return response;
  };
}
```

To make the context entry visible in downstream handler types, return `Middleware<…, …, SetContextTransform<typeof RequestId>>`. The exact transform helper names are exported from `remix/fetch-router` and roughly track each middleware that contributes a key.

### Async-local context (no prop-drilling)

```ts
import { asyncContext, getContext } from 'remix/async-context-middleware';

router.use(asyncContext());

// anywhere in the call tree, even deep utility code
let ctx = getContext();
let user = ctx.get(Auth).identity;
```

Useful for db loaders, logging, telemetry. It's a `RequestContext`-shaped `AsyncLocalStorage`.

---

## 7. Sessions

```ts
// app/session.ts
import { createCookie } from 'remix/cookie';
import { createFsSessionStorage } from 'remix/session/fs-storage';

export const sessionCookie = createCookie('session', {
  httpOnly: true,
  sameSite: 'lax',
  secure:   process.env.NODE_ENV === 'production',
  secrets:  [process.env.SESSION_SECRET!],
  maxAge:   60 * 60 * 24 * 30,
});

export const sessionStorage = createFsSessionStorage('./.sessions', {});
```

Backends:

| Backend | Module | Use |
|---|---|---|
| Cookie | `remix/session/cookie-storage` | Tiny payloads (~4KB cap), no server state |
| Memory | `remix/session/memory-storage` | Tests, dev only |
| Filesystem | `remix/session/fs-storage` | Single-node prod |
| Redis | `remix/session-storage-redis` | Distributed |
| Memcache | `remix/session-storage-memcache` | Distributed |

Reading/writing inside a handler:

```ts
import { Session } from 'remix/session-middleware';

export async function showCart(ctx: RequestContext) {
  let session = ctx.get(Session);
  let cart    = session.get('cart') ?? [];
  return createHtmlResponse(renderToStream(<Cart items={cart} />));
}

export async function addToCart(ctx: RequestContext) {
  let session = ctx.get(Session);
  let form    = ctx.get(FormData);
  let cart    = session.get('cart') ?? [];
  cart.push(form.get('itemId'));
  session.set('cart', cart);
  return redirect('/cart');
}
```

After login, call `session.regenerateId(true)` to mint a fresh id and discard the anonymous session.

`session.flash(key, value)` writes a value that survives exactly one subsequent request, then auto-deletes. Useful for one-time toast/error messages.

---

## 8. Auth

`auth({ schemes })` writes `Auth` to the context. `requireAuth()` is a downstream gate.

### 8.1 Session-backed scheme

```ts
// app/auth.ts
import { createSessionAuthScheme } from 'remix/auth-middleware';
import { db } from './db.js';

export const sessionScheme = createSessionAuthScheme<User, { userId: number }>({
  name: 'session',
  read(session) {
    let id = session.get('userId');
    return id ? { userId: id } : null;
  },
  async verify({ userId }) {
    return db.find(users, userId);          // returns User | null
  },
  invalidate(session) {
    session.unset('userId');
  },
});

export const schemes = [sessionScheme] as const;
```

Mount it in the router middleware chain (`auth({ schemes })`). After login, set `session.set('userId', user.id)`. After logout, `session.destroy()`.

### 8.2 Bearer token scheme (APIs)

```ts
import { createBearerTokenAuthScheme } from 'remix/auth-middleware';

export const bearerScheme = createBearerTokenAuthScheme<ApiClient>({
  name:       'bearer',
  scheme:     'Bearer',
  headerName: 'Authorization',
  challenge:  'Bearer realm="api"',
  async verify(token) {
    return await db.findOne(apiTokens, { token });
  },
});
```

### 8.3 API key scheme

```ts
import { createAPIAuthScheme } from 'remix/auth-middleware';

export const apiKeyScheme = createAPIAuthScheme<Org>({
  headerName: 'X-API-Key',
  async verify(key) { return await orgsByKey(key); },
});
```

Stack them: `auth({ schemes: [sessionScheme, bearerScheme] as const })`. Schemes run in order; first success wins. Each scheme's `verify` returns the identity, `null` to fail, or `null/undefined` from `read()` to skip the scheme entirely.

### 8.4 Requiring auth

```ts
import { requireAuth, Auth } from 'remix/auth-middleware';

router.get('/dashboard', {
  middleware: [requireAuth({ onFailure: () => redirect('/signin') })] as const,
  handler(ctx) {
    let user = ctx.get(Auth).identity;       // typed as User, not User | null
    return createHtmlResponse(renderToStream(<Dashboard user={user} />));
  },
});
```

For custom schemes, implement `AuthScheme<identity>` directly:

```ts
const customScheme: AuthScheme<User> = {
  name: 'custom',
  async authenticate(ctx) {
    let token = ctx.request.headers.get('x-custom-token');
    if (!token) return { status: 'failure', code: 'missing_credentials' };
    let user = await verifyToken(token);
    return user
      ? { status: 'success', identity: user }
      : { status: 'failure', code: 'invalid_credentials' };
  },
};
```

---

## 9. Forms and body parsing

Once `formData()` middleware is mounted, every request's parsed FormData is at `ctx.get(FormData)`.

```ts
import { FormData } from 'remix/form-data-middleware';

export async function createPost(ctx: RequestContext) {
  let form  = ctx.get(FormData);
  let title = String(form.get('title'));
  let body  = String(form.get('body'));
  let post  = await db.create(posts, { title, body });
  return redirect(`/posts/${post.id}`);
}
```

### 9.1 Validation with `data-schema/form-data`

```ts
import * as s from 'remix/data-schema';
import * as fd from 'remix/data-schema/form-data';

const PostSchema = fd.object({
  title: fd.field(s.string().pipe([s.minLength(1), s.maxLength(200)]), {}),
  body:  fd.field(s.string(), {}),
  tags:  fd.fields(s.string(), { name: 'tag' }),
});

export async function createPost(ctx: RequestContext) {
  let parsed = s.parseSafe(PostSchema, ctx.get(FormData));
  if (!parsed.success) return errorResponse(parsed.issues);
  let post = await db.create(posts, parsed.value);
  return redirect(`/posts/${post.id}`);
}
```

### 9.2 Method override (HTML PUT/DELETE)

With `methodOverride()` mounted:

```html
<form method="POST" action="/posts/42">
  <input type="hidden" name="_method" value="DELETE" />
  <button>Delete post</button>
</form>
```

The router will route this to the `DELETE /posts/:id` handler. `ctx.method` is `'DELETE'`; `ctx.request.method` is still `'POST'`.

### 9.3 File uploads

The `formData()` middleware accepts an `uploadHandler` for streaming uploads:

```ts
import { createFsFileStorage } from 'remix/file-storage/fs';

const uploads = createFsFileStorage('./uploads');

router = createRouter({
  middleware: [
    formData({
      maxFileSize: 50 * 1024 * 1024,
      uploadHandler: async (file) => {
        if (file.fieldName !== 'avatar') return;        // skip
        let key = `${crypto.randomUUID()}-${file.name}`;
        await uploads.set(key, file as unknown as File);
        return key;                                     // becomes the FormData value
      },
    }),
  ] as const,
});
```

Limit-violation errors are typed: `MaxFileSizeExceededError`, `MaxFilesExceededError`, `MaxHeaderSizeExceededError`, `MaxPartsExceededError`, `MaxTotalSizeExceededError`. Catch them in `RouterOptions.defaultHandler` or via per-route try/catch.

For raw control, `parseFormData(request, opts, uploadHandler)` from `remix/form-data-parser` is the same parser without the middleware wrapper.

---

## 10. Static files and assets

Two complementary pieces.

### 10.1 `staticFiles()` for `/public`

```ts
import { staticFiles } from 'remix/static-middleware';

router = createRouter({
  middleware: [
    staticFiles('./public', {
      cacheControl: 'public, max-age=3600',
      etag:         'strong',
      lastModified: true,
      index:        ['index.html'],
    }),
  ] as const,
});
```

Falls through to the next handler if the file doesn't exist. Range requests are auto-enabled for non-compressible types.

### 10.2 `createAssetServer()` for source modules

The `assets` package builds and serves TypeScript/JSX/CSS source files on demand (dev) or compiled+fingerprinted (prod):

```ts
import { createAssetServer } from 'remix/assets';

const assetServer = createAssetServer({
  basePath: '/assets',
  fileMap: {
    '/app/*path': 'app/*path',                  // serve files under ./app/...
  },
  allow:    ['app/**'],
  minify:   process.env.NODE_ENV === 'production',
  watch:    process.env.NODE_ENV !== 'production',
  fingerprint: process.env.NODE_ENV === 'production' ? {} : undefined,
});

router.get('/assets/*path', ({ request }) => assetServer.fetch(request));
```

Use `assetServer.getHref('app/components/client/Counter.ts')` to resolve a fingerprinted URL at SSR time. Wire that resolver into `renderToStream` via `resolveClientEntry`.

### 10.3 File responses

```ts
import { createFileResponse } from 'remix/response/file';
import { openLazyFile } from 'remix/fs';

router.get('/downloads/:id', async (ctx) => {
  let file = openLazyFile(`./downloads/${ctx.params.id}`);
  return createFileResponse(file, ctx.request, {
    cacheControl: 'private, max-age=60',
    etag:         'strong',
    acceptRanges: true,
  });
});
```

Handles conditional requests (`If-None-Match`, `If-Modified-Since`), `Range`, ETag generation.

---

## 11. HTML rendering

Two paths: send raw HTML strings via `html-template`, or render the UI tree via `renderToStream`.

### 11.1 Streaming SSR

```tsx
// app/components/App.tsx
export function App({ user }: { user: User | null }) {
  return (
    <html>
      <head><title>My App</title></head>
      <body>
        {user ? <Dashboard user={user} /> : <SigninForm />}
      </body>
    </html>
  );
}
```

```ts
// in a handler
import { renderToStream } from 'remix/ui/server';
import { createHtmlResponse } from 'remix/response/html';

return createHtmlResponse(renderToStream(<App user={user} />, {
  resolveClientEntry: async (entryId, component) => {
    // entryId is e.g. '/js/counter.js#Counter'
    let [path, exportName] = entryId.split('#');
    let href = await assetServer.getHref(path);
    return { href, exportName };
  },
  resolveFrame: async (src) => {
    // when an inline <Frame src="..."> is encountered during SSR
    let response = await router.fetch(new Request(new URL(src, ctx.url)));
    return response.body!;                         // stream into the parent doc
  },
  onError(err) { console.error('render error', err); },
}));
```

### 11.2 `createHtmlResponse`

Sets `Content-Type: text/html; charset=utf-8`, prepends `<!doctype html>` if missing, accepts a stream or string.

---

## 12. The UI layer

`@remix-run/ui` is a custom virtual DOM. **It is not React.**

### 12.1 Component model

```ts
import type { Handle } from 'remix/ui';

function Greeting(handle: Handle<{ name: string }>) {
  // setup runs once per instance
  console.log('mounted');
  handle.signal.addEventListener('abort', () => console.log('unmounted'));

  // render runs on every update; handle.props is always current
  return () => <h1>Hello, {handle.props.name}</h1>;
}
```

A component is `(handle) => renderFn`. The factory runs once per instance; the render closure runs on each update. `handle.props` is a stable object whose values change in place. `handle.update()` schedules a re-render. `handle.signal` aborts on unmount.

### 12.2 The `mix` prop

There are no `onClick`/`onChange` props. Behavior attaches via `mix={[...]}`:

```tsx
import { on, attrs } from 'remix/ui';

<button
  type="button"
  mix={[
    on('click', () => console.log('clicked')),
    attrs({ class: 'btn' }),
  ]}
>
  Click me
</button>
```

`on(type, handler)` is the typed event listener mixin. `attrs(defaults)` merges default attributes. Custom mixins via `createMixin(type)` for things like drag handlers, form binding, intersection observers.

### 12.3 Hydration islands with `clientEntry`

```tsx
// app/components/client/Counter.tsx
import { clientEntry, on } from 'remix/ui';

export const Counter = clientEntry(
  '/app/components/client/Counter.ts#Counter',
  function Counter(handle: Handle<{ initialCount?: number; label: string }>) {
    let count = handle.props.initialCount ?? 0;
    return () => (
      <button
        type="button"
        mix={[on('click', () => { count++; handle.update(); })]}
      >
        {handle.props.label} {count}
      </button>
    );
  },
);
```

The first arg is an entry ID (`<module-url>#<export-name>` by convention). At SSR time, `resolveClientEntry` translates it to the actual fingerprinted URL. On the client, `run({ loadModule, resolveFrame })` walks the document and hydrates each marker.

### 12.4 Sub-trees with `Frame`

```tsx
import { Frame } from 'remix/ui';

<Frame src="/users/42/profile" fallback={<Spinner />} />
```

During SSR, `resolveFrame` fetches that URL from the same router and inlines its rendered output. On the client, navigating inside the frame (or calling `navigate('/users/43/profile', { target: 'profile-frame' })`) replaces the frame's contents without a full-page reload.

`Frame` replaces nested-route layouts. Build composition by URL, not by component tree.

### 12.5 Client bootstrap

```ts
// app/entry.client.ts
import { run } from 'remix/ui';

run({
  loadModule(url, exportName) {
    return import(url).then((m) => m[exportName]);
  },
  resolveFrame(src) {
    return fetch(src).then((r) => r.body!);
  },
});
```

Ship this as the entry point of your client bundle. The asset server handles building/serving it.

---

## 13. Pre-built UI components

`remix/ui/*` ships a small component library with the same `mix=` extension model. Available: `anchor` (positioning primitive for popovers/menus/tooltips), `button` (with `tone`, `startIcon`, `endIcon`), `menu` + `MenuTrigger` + `MenuList` + `MenuItem` + `Submenu`, `listbox`, `combobox`, `breadcrumbs`, `accordion`, `glyph` (icons), plus `theme` for design tokens.

Theme:

```ts
import { createTheme } from 'remix/ui/theme';

const theme = createTheme({
  selector: ':root',
  reset:    true,
  // tokens: spacing, radii, colors, typography, shadows...
});
```

Apply tokens at the document root; components consume them via CSS variables.

---

## 14. Database

Use `data-table` for typed queries and `data-schema` for input validation. They're independent.

### 14.1 Defining tables

```ts
// app/db/schema.ts
import { table, column as c, timestamps } from 'remix/data-table';

export const users = table({
  name: 'users',
  columns: {
    id:    c.integer().primaryKey().autoIncrement(),
    email: c.varchar(255).notNull().unique(),
    name:  c.varchar(255).notNull(),
    ...timestamps(),
  },
});

export const posts = table({
  name: 'posts',
  columns: {
    id:      c.integer().primaryKey().autoIncrement(),
    userId:  c.integer().notNull().references(users.columns.id),
    title:   c.varchar(255).notNull(),
    body:    c.text().notNull(),
    ...timestamps(),
  },
});
```

### 14.2 Connecting

```ts
// app/db/index.ts
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from 'remix/data-table';
import { createSqliteDatabaseAdapter } from 'remix/data-table-sqlite';

const sqlite  = new DatabaseSync('./data/app.db');
const adapter = createSqliteDatabaseAdapter(sqlite);
export const db = createDatabase(adapter);
```

Postgres and MySQL adapters: `createPgDatabaseAdapter(client)`, `createMysqlDatabaseAdapter(client)` (analogous shapes).

### 14.3 Querying

```ts
import { db } from './db.js';
import { users, posts } from './db/schema.js';
import { eq, gte, and } from 'remix/data-table';

await db.find(users, 1);
await db.findOne(users, { where: { email: 'a@b.c' } });
await db.findMany(posts, {
  where: and(eq(posts.columns.userId, 1), gte(posts.columns.createdAt, since)),
  orderBy: { createdAt: 'desc' },
  limit:   20,
});
await db.create(users, { email: 'a@b.c', name: 'A' });
await db.update(users, 1, { name: 'A. New' });
await db.delete(users, 1);

// chainable
let rows = await db.query(posts).where({ userId: 1 }).orderBy({ id: 'desc' }).all();

// raw SQL with parameter binding
import { sql } from 'remix/data-table';
let result = await db.exec(sql`select count(*) from posts where userId = ${userId}`);
```

Transactions:

```ts
await db.transaction(async (tx) => {
  let user = await tx.create(users, data);
  await tx.create(posts, { userId: user.id, title, body });
});
```

### 14.4 Migrations

```ts
// app/db/migrations/0001-init.ts
import { createMigration } from 'remix/data-table/migrations';
import { users } from '../schema.js';

export default createMigration({
  async up({ schema }) {
    await schema.createTable(users);
  },
  async down({ schema }) {
    await schema.dropTable('users', { ifExists: true });
  },
});
```

```ts
// app/db/migrate.ts (run via a CLI script)
import { createMigrationRunner } from 'remix/data-table/migrations';
import { loadMigrations } from 'remix/data-table/migrations/node';
import { db } from './index.js';

let migrations = await loadMigrations('./app/db/migrations');
let runner     = createMigrationRunner(db.adapter, migrations, { journalTable: 'app_migrations' });
await runner.up();
```

---

## 15. Validation

`remix/data-schema` is a Standard-Schema-v1 compatible validator with `parse` / `parseSafe`:

```ts
import * as s from 'remix/data-schema';
import { email, minLength, maxLength } from 'remix/data-schema/checks';

const SignupSchema = s.object({
  email:    s.string().pipe([email()]),
  password: s.string().pipe([minLength(12), maxLength(256)]),
  age:      s.number().refine((n) => n >= 13, 'must be 13+'),
});

let parsed = s.parseSafe(SignupSchema, body);
if (!parsed.success) return badRequest(parsed.issues);
let { email: e, password: p, age } = parsed.value;        // typed
```

Coercers (`remix/data-schema/coerce`): `number`, `boolean`, `bigint`, `date`, `string` for converting raw form fields. `data-schema/form-data` adapts the shape to `FormData`/`URLSearchParams`. `data-schema/lazy` for recursive schemas.

---

## 16. Cookies and headers

Typed parsers, no string juggling.

```ts
import { Cookie, SetCookie, CacheControl, Accept, ContentType } from 'remix/headers';

let accept = new Accept(ctx.headers.get('accept') ?? '');
let preferred = accept.getPreferred(['application/json', 'text/html']);

let cc = new CacheControl();
cc.maxAge   = 3600;
cc.public   = true;
response.headers.set('cache-control', cc.toString());

let set = new SetCookie('session=abc123');
set.httpOnly = true;
set.sameSite = 'lax';
response.headers.append('set-cookie', set.toString());
```

`createCookie` (signing/encoding wrapper) lives in `remix/cookie`; you used it for session storage already.

`mime` package: `detectMimeType(ext)`, `mimeTypeToContentType(type)`, `isCompressibleMimeType(type)`, `defineMimeType({ extensions, mimeType })`.

---

## 17. Putting it all together

A minimal but complete app skeleton:

```ts
// app/server.ts
import { serve } from 'remix/node-serve';
import { createRouter } from 'remix/fetch-router';
import { logger } from 'remix/logger-middleware';
import { compression } from 'remix/compression-middleware';
import { staticFiles } from 'remix/static-middleware';
import { formData, FormData } from 'remix/form-data-middleware';
import { methodOverride } from 'remix/method-override-middleware';
import { session, Session } from 'remix/session-middleware';
import { auth, Auth, requireAuth } from 'remix/auth-middleware';
import { csrf } from 'remix/csrf-middleware';
import { createCookie } from 'remix/cookie';
import { createFsSessionStorage } from 'remix/session/fs-storage';
import { createSessionAuthScheme } from 'remix/auth-middleware';
import { renderToStream } from 'remix/ui/server';
import { createHtmlResponse } from 'remix/response/html';
import { redirect } from 'remix/response/redirect';

import { db } from './db/index.js';
import { users } from './db/schema.js';
import { App, Dashboard, SigninForm } from './components/index.js';
import { assetServer } from './assets.js';

const sessionCookie  = createCookie('session', {
  httpOnly: true, sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  secrets: [process.env.SESSION_SECRET!],
});
const sessionStorage = createFsSessionStorage('./.sessions', {});

const sessionScheme = createSessionAuthScheme({
  name: 'session',
  read(s) {
    let id = s.get('userId');
    return id ? { userId: id } : null;
  },
  verify({ userId }) { return db.find(users, userId); },
  invalidate(s)      { s.unset('userId'); },
});

const router = createRouter({
  middleware: [
    logger({}),
    compression(),
    staticFiles('./public', {}),
    session(sessionCookie, sessionStorage),
    formData({ maxFileSize: 10 * 1024 * 1024 }),
    methodOverride({}),
    csrf({ tokenKey: 'csrf' }),
    auth({ schemes: [sessionScheme] as const }),
  ] as const,
});

const renderOpts = {
  resolveClientEntry: async (entryId: string) => {
    let [path, name] = entryId.split('#');
    return { href: await assetServer.getHref(path), exportName: name };
  },
  resolveFrame: async (src: string) => {
    let res = await router.fetch(new Request(new URL(src, 'http://localhost')));
    return res.body!;
  },
};

router.get('/assets/*path', ({ request }) => assetServer.fetch(request));

router.get('/', (ctx) => {
  let user = ctx.get(Auth)?.identity ?? null;
  return createHtmlResponse(renderToStream(<App user={user} />, renderOpts));
});

router.get('/signin', () =>
  createHtmlResponse(renderToStream(<SigninForm />, renderOpts)));

router.post('/signin', async (ctx) => {
  let form = ctx.get(FormData);
  let user = await db.findOne(users, { where: { email: String(form.get('email')) } });
  if (!user) return redirect('/signin?error=1');
  let session = ctx.get(Session);
  session.regenerateId(true);
  session.set('userId', user.id);
  return redirect('/');
});

router.post('/signout', (ctx) => {
  ctx.get(Session).destroy();
  return redirect('/');
});

router.get('/dashboard', {
  middleware: [requireAuth({ onFailure: () => redirect('/signin') })] as const,
  handler(ctx) {
    let user = ctx.get(Auth).identity;
    return createHtmlResponse(renderToStream(<Dashboard user={user} />, renderOpts));
  },
});

let server = serve(router.fetch, { port: Number(process.env.PORT) || 3000 });
await server.ready;
console.log(`listening on ${server.port}`);
```

That's a complete authenticated app: session cookie, login/logout, gated dashboard, streaming SSR, hydration-ready bundle, static + dynamic assets, CSRF protection, gzip/brotli compression, structured logs.

---

## 18. Deployment notes

- **`node-serve`** (uWebSockets) is the recommended production transport. It outperforms Node `http` and supports TLS via `tls: { certFile, keyFile }`.
- **Fingerprinted assets** require `createAssetServer({ fingerprint: {...} })` in production with `watch: false`. The server caches the build output; redeploying invalidates.
- **Sessions** in multi-node deployments need `session-storage-redis` or `session-storage-memcache`; cookie storage works everywhere but is capped at ~4KB.
- **CSRF** middleware requires session middleware before it. Forms must include `<input type="hidden" name="csrf" value={getCsrfToken(ctx, 'csrf')}>`.
- **Compression** is automatic and skips already-compressed/range/no-transform responses. No need to disable per-route.
- **Health checks** are just `router.get('/health', () => new Response('ok'))`.

---

## 19. What's deliberately not here

- File-based routing. There's no convention.
- A `loader`/`useLoaderData` data hook. Handlers pass props.
- Per-component data fetching. Data loading is at the handler level or via `Frame src` for sub-trees.
- A built-in client-side state library. Component closures + `handle.update()` is the model.
- Plug-and-play OAuth providers. Auth schemes are author-defined; `auth-middleware` provides the contract and three built-in scheme factories (session/bearer/API key).

---

## 20. Reference index

| Concern | Package |
|---|---|
| Server | `remix/node-serve`, `remix/node-fetch-server` |
| Routing | `remix/fetch-router`, `remix/fetch-router/routes`, `remix/route-pattern` |
| Middleware | `remix/{logger,compression,cors,csrf,static,form-data,method-override,session,auth,async-context}-middleware` |
| Sessions | `remix/session`, `remix/session/{cookie,fs,memory}-storage`, `remix/session-storage-{redis,memcache}` |
| Auth | `remix/auth-middleware`, `remix/auth` |
| Validation | `remix/data-schema`, `remix/data-schema/{checks,coerce,form-data,lazy}` |
| Database | `remix/data-table`, `remix/data-table-{sqlite,postgres,mysql}`, `remix/data-table/migrations` |
| Forms | `remix/form-data-parser`, `remix/multipart-parser` |
| Files | `remix/file-storage`, `remix/file-storage/{fs,memory}`, `remix/file-storage-s3`, `remix/lazy-file`, `remix/fs` |
| Responses | `remix/response/{html,redirect,file,compress}` |
| Headers | `remix/headers`, `remix/cookie`, `remix/mime` |
| Assets | `remix/assets` |
| Rendering | `remix/ui`, `remix/ui/server`, `remix/html-template` |
| UI library | `remix/ui/{anchor,button,menu,listbox,combobox,breadcrumbs,accordion,glyph,theme,animation}` |
| Tooling | `remix/cli`, `remix/test`, `remix/terminal` |
