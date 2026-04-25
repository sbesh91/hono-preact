# Watched-Movies Tracker — Proof-of-Concept Design

## Purpose

Use `apps/app` as a proof-of-concept that exercises every feature available in the `@hono-preact` framework: unified server loaders, server actions (JSON and multipart), `<Form>`, streaming actions with `onChunk`, named caches with cross-page invalidation, optimistic updates, and `useReload`. The vehicle is a small "movies I've watched" tracker layered onto the existing movies pages plus a new `/watched` page.

In-memory server state only — no database. No authentication or guarding (intentionally out of scope; `serverGuards` / `clientGuards` / `actionGuards` are not exercised here and remain documented elsewhere).

## Architecture overview

### Routing surface

The unified-loader migration replaced the old per-page `/api/movies` GET endpoints. Actions and loaders both run through framework RPC routes.

| Route | Purpose |
|---|---|
| `POST /__loaders` | Auto-mounted via `loadersHandler` — fixes a regression where this was never registered |
| `POST /__actions` | Auto-mounted via `actionsHandler` — already in place |
| `GET /api/watched/:movieId/photo` | Only manual route — serves photo bytes for `<img src=…>` |
| `GET *` | SSR catch-all |

The existing `/api/movies` and `/api/movies/:id` routes are deleted — they were the old `clientLoader` fetch targets, replaced by `/__loaders`.

### Pages

| Route | Loader returns | Cache name |
|---|---|---|
| `/movies` (modified) | `{ movies, watchedIds: number[] }` | `'movies-list'` |
| `/movies/:id` (modified) | `{ movie, watched: WatchedRecord \| null }` | unnamed (route-param-keyed) |
| `/watched` (new) | `{ entries: Array<{ movie, watched }> }` | `'watched'` |

`watchedIds` is sent over the wire as an array (JSON-safe) and converted to a `Set` in the component if useful for O(1) lookups.

### Server data layer

New file `apps/app/src/server/watched.ts` holds the watched store as a module-level `Map<number, WatchedRecord>`:

```ts
type WatchedRecord = {
  movieId: number;
  watchedAt: number;          // unix ms
  notes: string;              // default ''
  photo?: { contentType: string; bytes: Uint8Array; filename: string };
};
```

Exported async functions form the API:

```ts
export async function listWatched(): Promise<WatchedRecord[]>;
export async function getWatched(id: number): Promise<WatchedRecord | null>;
export async function markWatched(id: number): Promise<void>;     // no-op if already watched
export async function unmarkWatched(id: number): Promise<void>;
export async function setNotes(id: number, notes: string): Promise<void>;
export async function setPhoto(id: number, photo: NonNullable<WatchedRecord['photo']>): Promise<void>;
export async function removeWatched(id: number): Promise<void>;
```

`setNotes` and `setPhoto` auto-create a record if one doesn't exist, so notes/photos can attach to a movie before marking it watched. Async signatures keep call sites identical to a future DB-backed implementation.

A test-only `__resetForTests()` helper is exported (gated by `if (import.meta.env?.MODE === 'test')` or simply prefixed and not documented) so unit tests can clear the map between cases.

## Per-page behavior

### `/movies` (list page, modified)

**Loader** (`movies.server.ts`)
```ts
const serverLoader: Loader<{ movies: MoviesData; watchedIds: number[] }> = async () => {
  const movies = await getMovies();
  const watchedIds = (await listWatched()).map((r) => r.movieId);
  return { movies, watchedIds };
};
```

**Component** (`movies.tsx`)
- Each row shows the title and a small "✓ watched" badge if the id is in `watchedIds`.
- Per-row toggle button:
  ```ts
  useAction(serverActions.toggleWatched, {
    onMutate: ({ movieId, watched }) => {
      const prev = watchedIds;
      setWatchedIds(watched ? [...prev, movieId] : prev.filter((id) => id !== movieId));
      return prev;
    },
    onError: (_, snapshot) => setWatchedIds(snapshot as number[]),
    invalidate: ['watched'],
  })
  ```
- Local `watchedIds` state is seeded from `loaderData.watchedIds` so optimistic updates can flip the badge immediately.

**Action**: `toggleWatched({ movieId, watched })` calls `markWatched` or `unmarkWatched` accordingly, returns `{ ok: true }`.

**Cleanup folded in:**
- Remove `clientLoader` definition and the `clientLoader` prop on `getLoaderData`.
- Remove `cache.wrap(...)` wrapper.
- Fix the `FunctionalComponent` typing so it accepts `LoaderData<{ movies, watchedIds }>`.

### `/movies/:id` (detail page, modified)

**Loader** (`movie.server.ts`)
```ts
const serverLoader: Loader<{ movie: Movie | null; watched: WatchedRecord | null }> =
  async ({ location }) => {
    const id = Number(location.pathParams.id);
    const [movie, watched] = await Promise.all([getMovie(String(id)), getWatched(id)]);
    return { movie, watched };
  };
```

**Component** (`movie.tsx`)
- Toggle button using `useAction(serverActions.toggleWatched, { invalidate: 'auto', onSuccess: () => { cacheRegistry.invalidate('watched'); cacheRegistry.invalidate('movies-list'); } })`. The `'auto'` reloads the current page; `onSuccess` clears the other pages' caches so they re-fetch on next visit.
  - Alternative form (also demonstrated): `invalidate: ['watched', 'movies-list']` plus `useReload()` from `onSuccess`. We'll use whichever is cleaner per call site; the design covers both options.
- Notes form using `<Form action={serverActions.setNotes}>` with a hidden `movieId` input and a textarea named `notes`. JSON path of `<Form>` (no files).
- Photo upload form using `<Form action={serverActions.setPhoto}>` with a hidden `movieId` input and `<input type="file" name="photo">`. Multipart path of `<Form>`. On success: `invalidate: ['watched']`.
- Manual "Refresh" button calling `useReload()`.

**Actions**: `toggleWatched`, `setNotes({ movieId, notes })`, `setPhoto({ movieId, photo: File })`. The `setPhoto` action reads the `File` directly from the payload, converts via `await photo.arrayBuffer()` to a `Uint8Array`, and stores it.

**Cleanup folded in:**
- Remove `clientLoader` and fix typings.

### `/watched` (new page)

**Loader** (`watched.server.ts`)
```ts
const serverLoader: Loader<{ entries: Array<{ movie: Movie | null; watched: WatchedRecord }> }> =
  async () => {
    const records = await listWatched();
    const entries = await Promise.all(
      records.map(async (w) => ({ movie: await getMovie(String(w.movieId)), watched: w }))
    );
    return { entries };
  };
```

**Component** (`watched.tsx`)
- Each entry: movie title, watched date, notes preview, and `<img src="/api/watched/{movieId}/photo">` if a photo exists.
- Per-row Remove button: `useAction(serverActions.removeWatched, { invalidate: 'auto', onMutate: optimistic-filter, onError: rollback })`.
- Bulk-import button: `useAction(serverActions.bulkImportWatched, { onChunk: (s) => setProgress(JSON.parse(s)), onSuccess: () => { useReload(); cacheRegistry.invalidate('movies-list'); } })`.
  - Streams `{ count: 1, total: 20 }\n` per processed movie.
- Suspense fallback passed to `getLoaderData` for the initial load shimmer.

**Actions**: `removeWatched({ movieId })`, `bulkImportWatched()` returning a `ReadableStream`.

**`bulkImportWatched` implementation:**

```ts
bulkImportWatched: defineAction<void, never>(async () => {
  const target = (await getMovies()).results.slice(0, 20);
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let count = 0;
      for (const m of target) {
        await markWatched(m.id);
        count++;
        controller.enqueue(encoder.encode(JSON.stringify({ count, total: target.length }) + '\n'));
        await new Promise((r) => setTimeout(r, 150)); // visible progress
      }
      controller.close();
    },
  });
}),
```

## Feature-coverage map

| Framework feature | Where exercised |
|---|---|
| Unified `serverLoader` | All three pages |
| `defineAction` + `useAction` (JSON) | Toggle on `/movies` and `/movies/:id`; remove on `/watched` |
| `defineAction` + `useAction` (multipart) | Covered transitively by `<Form>` multipart path — both share the same `hasFileValues` branch. Not separately demoed in app code. |
| `<Form>` (JSON path) | Notes form on `/movies/:id` |
| `<Form>` (multipart path) | Photo upload on `/movies/:id` |
| Streaming action with `onChunk` | Bulk import on `/watched` |
| `invalidate: 'auto'` | Detail-page actions, `/watched` remove |
| `invalidate: string[]` | Toggle on `/movies`, photo upload, post-bulk-import |
| Optimistic update (`onMutate`/`onError`) | Toggle on `/movies`, remove on `/watched` |
| Named caches + `cacheRegistry` | `'movies-list'`, `'watched'` |
| `useReload` | Manual refresh on detail page; bulk-import success |
| Suspense fallback | `/watched` initial load |

Out of scope (per request): `serverGuards`, `clientGuards`, `actionGuards`.

## Routing / handler changes (`server.tsx`)

The current file:
```tsx
app
  .post('/__actions', actionsHandler(import.meta.glob('./pages/*.server.ts')))
  .get('/api/movies', ...)         // delete — redundant
  .get('/api/movies/:id', ...)     // delete — redundant
  .use(location)
  .get('*', renderPage(...));
```

Becomes:
```tsx
app
  .post('/__loaders', loadersHandler(import.meta.glob('./pages/*.server.ts')))
  .post('/__actions', actionsHandler(import.meta.glob('./pages/*.server.ts')))
  .get('/api/watched/:movieId/photo', servePhoto)
  .use(location)
  .get('*', renderPage(...));
```

`servePhoto` reads from `getWatched(id)`, returns the photo bytes with the stored `Content-Type`, and 404s if the record or photo is absent.

## Testing approach

**Unit tests** — `apps/app/src/server/__tests__/watched.test.ts`:
- `markWatched` adds an entry; calling twice is a no-op (no duplicate, watchedAt unchanged).
- `unmarkWatched` removes the entry.
- `setNotes` on an unwatched id creates a record with `watchedAt = 0` (sentinel meaning "not yet marked watched, record exists for notes/photo only") and the notes set. Components treat `watchedAt === 0` as not-watched when computing the watched badge.
- `setPhoto` stores bytes and content-type round-trip.
- `removeWatched` empties the map.
- `listWatched` returns all entries.

Total: ~6–8 small tests using a `__resetForTests` helper in `beforeEach`.

**No automated tests for the page components** — the framework packages already have thorough unit coverage for `useAction`, `<Form>`, streaming, multipart, named caches, etc. App-page mechanics are verified manually in the browser.

**Manual verification checklist** (run after implementation):
- `/movies` toggle: badge appears immediately (optimistic); persists across refresh; `/watched` reflects the change on next visit.
- `/movies/:id` notes: save persists; photo upload renders via `/api/watched/:id/photo`.
- `/watched`: bulk import shows progress advancing; both `/movies` badges and `/watched` reflect imports after completion; remove updates list immediately and persists.
- Navigation between `/movies`, `/movies/:id`, `/watched` never triggers the broken-`/__loaders` JSON-parse error (verifies the unified-loader cleanup).

**Verification gates:**
- `pnpm --filter app exec tsc --noEmit` — must pass (currently failing because of the unified-loader regressions).
- `pnpm test` — must stay green; new watched-store tests bring the count from 146 → ~152.

## Migration cleanup folded into this work

Bundled because the same files are being modified anyway:

1. **Add `loadersHandler` to `server.tsx`** — the unified-loader migration's missing piece. Without this, client-side navigation 404s into the SSR catch-all and the RPC stub throws on JSON parse.
2. **Remove `clientLoader` from `movies.tsx` and `movie.tsx`** — both still pass the prop, which was removed from `LoaderProps`. `tsc` is currently red.
3. **Remove `cache.wrap(...)` usage in `movies.tsx`** — defunct under the unified loader (page.tsx writes the cache itself after the loader resolves).
4. **Delete `/api/movies` and `/api/movies/:id`** — redundant with the unified loader.
5. **Fix `actions.mdx:89`** — wording still says "re-runs the page's `clientLoader`"; update to `serverLoader`.

## Out of scope

- Authentication, server/client/action guards.
- Persistence beyond process memory (no database, no localStorage backup).
- Multi-user separation — there is one global "watched" set.
- Photo size limits, content-type validation, virus scanning. POC.
- Photo cleanup on `removeWatched` — bytes are released when the record is deleted (Map.delete drops the reference); no separate disposal needed for in-memory.
- Pagination on `/watched` — list is small.
