# Watched-Movies Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "movies I've watched" tracker to `apps/app` that exercises every framework feature (unified loader, server actions, `<Form>`, multipart uploads, streaming actions with `onChunk`, named caches with cross-page invalidation, optimistic updates, `useReload`, Suspense fallback). Bundle in the cleanup of the broken-after-unified-loader app code.

**Architecture:** A new in-memory store (`apps/app/src/server/watched.ts`) backs three pages: `/movies` (list with toggle), `/movies/:id` (detail with notes + photo upload), `/watched` (new, with bulk-import streaming). Photo bytes are served via the only manual `/api` route; everything else flows through `/__loaders` and `/__actions`. The unified-loader cleanup (mount `loadersHandler`, remove `clientLoader` props, drop redundant `/api/movies*` routes) is folded in.

**Tech Stack:** Hono, Preact + preact-iso, `@hono-preact/iso` and `@hono-preact/server` workspace packages, Vite, Vitest, Tailwind CSS v4.

**Spec:** `docs/superpowers/specs/2026-04-25-watched-tracker-design.md`.

**Important commit policy:** This repo's `CLAUDE.md` says *"Never commit or push code unless explicitly told to do so."* Each task ends with a "ready to commit" step rather than an automatic `git commit`. The executor should pause for the user's go-ahead before committing.

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `apps/app/src/server/watched.ts` | In-memory `Map`-backed CRUD for watched records. Exports async functions only; no shared mutable state escapes the module. Includes `__resetForTests` for unit tests. |
| `apps/app/src/server/__tests__/watched.test.ts` | Unit tests for the data layer. |
| `apps/app/src/pages/watched.server.ts` | `/watched` page loader + actions (`removeWatched`, `bulkImportWatched`). |
| `apps/app/src/pages/watched.tsx` | `/watched` page component. |

### Modified files
| Path | Change |
|---|---|
| `vitest.config.ts` | Add `apps/app/src/**/__tests__/**/*.test.{ts,tsx}` to `test.include`. |
| `apps/app/src/server.tsx` | Mount `loadersHandler` at `/__loaders`; drop `/api/movies` and `/api/movies/:id`; add `GET /api/watched/:movieId/photo`. |
| `apps/app/src/iso.tsx` | Register `/watched` route. |
| `apps/app/src/pages/movies.server.ts` | Loader returns `watchedIds`; add `serverActions.toggleWatched`. |
| `apps/app/src/pages/movies.tsx` | Drop `clientLoader` and `cache.wrap`; add toggle UI with optimistic update; fix typings. |
| `apps/app/src/pages/movie.server.ts` | Loader returns `watched` record; add `serverActions.toggleWatched`, `setNotes`, `setPhoto`. |
| `apps/app/src/pages/movie.tsx` | Drop `clientLoader`; add toggle button, notes `<Form>`, photo `<Form>`, refresh button; fix typings. |
| `apps/app/src/pages/docs/actions.mdx` | Fix stale `clientLoader` wording on line 89. |

---

## Task 1: Update vitest config to pick up app tests

**Files:**
- Modify: `vitest.config.ts`

The current vitest config only globs `packages/*/src/__tests__/**`. The new app-side tests need their own include entry, otherwise they're invisible to `pnpm test`.

- [ ] **Step 1: Edit `vitest.config.ts`**

Add the apps include line. The full updated `include` array:

```ts
include: [
  'packages/iso/src/__tests__/**/*.test.{ts,tsx}',
  'packages/server/src/__tests__/**/*.test.{ts,tsx}',
  'packages/vite/src/__tests__/**/*.test.ts',
  'apps/app/src/**/__tests__/**/*.test.{ts,tsx}',
],
```

- [ ] **Step 2: Verify config still parses**

Run: `pnpm test`
Expected: PASS — same 146 tests, no new tests yet.

- [ ] **Step 3: Ready to commit**

Suggested message: `chore(test): include apps/app tests in vitest discovery`.
Wait for user go-ahead.

---

## Task 2: Watched store — write failing tests

**Files:**
- Create: `apps/app/src/server/__tests__/watched.test.ts`

We're going TDD on the data layer because it's the most reusable piece and is the easiest place for an off-by-one bug to hide. The store is module-level state, so we expose a private `__resetForTests` to clear it between cases.

- [ ] **Step 1: Create the test file**

```ts
// apps/app/src/server/__tests__/watched.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetForTests,
  getWatched,
  listWatched,
  markWatched,
  removeWatched,
  setNotes,
  setPhoto,
  unmarkWatched,
} from '../watched.js';

beforeEach(() => {
  __resetForTests();
});

describe('watched store', () => {
  it('markWatched creates a record with watchedAt > 0 and empty notes', async () => {
    await markWatched(42);
    const rec = await getWatched(42);
    expect(rec).not.toBeNull();
    expect(rec!.movieId).toBe(42);
    expect(rec!.watchedAt).toBeGreaterThan(0);
    expect(rec!.notes).toBe('');
    expect(rec!.photo).toBeUndefined();
  });

  it('markWatched twice is a no-op (watchedAt unchanged on second call)', async () => {
    await markWatched(42);
    const first = (await getWatched(42))!.watchedAt;
    await new Promise((r) => setTimeout(r, 5));
    await markWatched(42);
    const second = (await getWatched(42))!.watchedAt;
    expect(second).toBe(first);
  });

  it('unmarkWatched removes the record entirely', async () => {
    await markWatched(42);
    await unmarkWatched(42);
    expect(await getWatched(42)).toBeNull();
    expect(await listWatched()).toEqual([]);
  });

  it('setNotes on an unwatched id creates a record with watchedAt=0', async () => {
    await setNotes(42, 'great movie');
    const rec = await getWatched(42);
    expect(rec).not.toBeNull();
    expect(rec!.watchedAt).toBe(0);
    expect(rec!.notes).toBe('great movie');
  });

  it('setNotes on an already-watched id preserves watchedAt', async () => {
    await markWatched(42);
    const before = (await getWatched(42))!.watchedAt;
    await setNotes(42, 'updated');
    const after = (await getWatched(42))!;
    expect(after.watchedAt).toBe(before);
    expect(after.notes).toBe('updated');
  });

  it('setPhoto stores bytes and content-type', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await setPhoto(42, { contentType: 'image/png', bytes, filename: 'x.png' });
    const rec = await getWatched(42);
    expect(rec!.photo).toEqual({ contentType: 'image/png', bytes, filename: 'x.png' });
  });

  it('setPhoto on an unwatched id creates a record with watchedAt=0', async () => {
    await setPhoto(42, {
      contentType: 'image/png',
      bytes: new Uint8Array([0]),
      filename: 'x.png',
    });
    const rec = await getWatched(42);
    expect(rec).not.toBeNull();
    expect(rec!.watchedAt).toBe(0);
  });

  it('removeWatched empties the record', async () => {
    await markWatched(42);
    await markWatched(7);
    await removeWatched(42);
    expect(await getWatched(42)).toBeNull();
    const list = await listWatched();
    expect(list.map((r) => r.movieId)).toEqual([7]);
  });

  it('listWatched returns all current records', async () => {
    await markWatched(1);
    await markWatched(2);
    await markWatched(3);
    const list = await listWatched();
    expect(list.map((r) => r.movieId).sort()).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test apps/app/src/server/__tests__/watched.test.ts`
Expected: FAIL with module-not-found or all 9 cases failing because `../watched.js` does not exist yet.

---

## Task 3: Watched store — implement to pass tests

**Files:**
- Create: `apps/app/src/server/watched.ts`

- [ ] **Step 1: Create the implementation**

```ts
// apps/app/src/server/watched.ts
export type WatchedRecord = {
  movieId: number;
  watchedAt: number;
  notes: string;
  photo?: { contentType: string; bytes: Uint8Array; filename: string };
};

const store = new Map<number, WatchedRecord>();

export async function listWatched(): Promise<WatchedRecord[]> {
  return [...store.values()];
}

export async function getWatched(id: number): Promise<WatchedRecord | null> {
  return store.get(id) ?? null;
}

export async function markWatched(id: number): Promise<void> {
  const existing = store.get(id);
  if (existing && existing.watchedAt > 0) return;
  store.set(id, {
    movieId: id,
    watchedAt: Date.now(),
    notes: existing?.notes ?? '',
    photo: existing?.photo,
  });
}

export async function unmarkWatched(id: number): Promise<void> {
  store.delete(id);
}

export async function setNotes(id: number, notes: string): Promise<void> {
  const existing = store.get(id);
  store.set(id, {
    movieId: id,
    watchedAt: existing?.watchedAt ?? 0,
    notes,
    photo: existing?.photo,
  });
}

export async function setPhoto(
  id: number,
  photo: NonNullable<WatchedRecord['photo']>
): Promise<void> {
  const existing = store.get(id);
  store.set(id, {
    movieId: id,
    watchedAt: existing?.watchedAt ?? 0,
    notes: existing?.notes ?? '',
    photo,
  });
}

export async function removeWatched(id: number): Promise<void> {
  store.delete(id);
}

export function __resetForTests(): void {
  store.clear();
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test apps/app/src/server/__tests__/watched.test.ts`
Expected: PASS — all 9 cases.

- [ ] **Step 3: Ready to commit**

Suggested message: `feat(app): add in-memory watched-movies store with CRUD API`.

---

## Task 4: Mount `loadersHandler` and add photo route

**Files:**
- Modify: `apps/app/src/server.tsx`

This unblocks client-side navigation (currently broken because the unified-loader RPC stub fetches `/__loaders` but no route was mounted) and adds the photo-serving route. The redundant `/api/movies*` routes are removed.

- [ ] **Step 1: Replace the file**

```tsx
// apps/app/src/server.tsx
import { Hono } from 'hono';
import { env } from '@hono-preact/iso';
import { Layout } from './server/layout.js';
import {
  actionsHandler,
  loadersHandler,
  location,
  renderPage,
} from '@hono-preact/server';
import { getWatched } from './server/watched.js';

const dev = process.env.NODE_ENV === 'development';
if (dev) {
  const { default: dot } = await import('dotenv');
  dot.config({ debug: true });
}
export const app = new Hono();

env.current = 'server';

app
  .post('/__loaders', loadersHandler(import.meta.glob('./pages/*.server.ts')))
  .post('/__actions', actionsHandler(import.meta.glob('./pages/*.server.ts')))
  .get('/api/watched/:movieId/photo', async (c) => {
    const id = Number(c.req.param('movieId'));
    if (!Number.isFinite(id)) return c.notFound();
    const rec = await getWatched(id);
    if (!rec?.photo) return c.notFound();
    return new Response(rec.photo.bytes, {
      headers: {
        'Content-Type': rec.photo.contentType,
        'Cache-Control': 'no-store',
      },
    });
  })
  .use(location)
  .get('*', (c) =>
    renderPage(c, <Layout context={c} />, { defaultTitle: 'hono-preact' })
  );

export default app;
```

- [ ] **Step 2: Smoke-check the dev server starts**

Run: `pnpm dev`
Expected: server starts without import or compile errors. Stop the server (Ctrl+C) once it's confirmed running.

Note: this task does not yet make the app type-check — `movies.tsx` and `movie.tsx` still pass `clientLoader`. That's fixed in Task 6.

- [ ] **Step 3: Ready to commit**

Suggested message: `fix(app): mount loadersHandler, drop redundant /api/movies routes, add /api/watched/:id/photo`.

---

## Task 5: `movies.server.ts` — expose `watchedIds` and add `toggleWatched`

**Files:**
- Modify: `apps/app/src/pages/movies.server.ts`

- [ ] **Step 1: Replace the file**

```ts
// apps/app/src/pages/movies.server.ts
import { getMovies } from '@/server/movies.js';
import { defineAction, type Loader } from '@hono-preact/iso';
import type { MoviesData } from '@/server/data/movies.js';
import { listWatched, markWatched, unmarkWatched } from '@/server/watched.js';

const serverLoader: Loader<{ movies: MoviesData; watchedIds: number[] }> = async () => {
  const [movies, watched] = await Promise.all([getMovies(), listWatched()]);
  return { movies, watchedIds: watched.map((w) => w.movieId) };
};

export default serverLoader;

export const serverActions = {
  toggleWatched: defineAction<{ movieId: number; watched: boolean }, { ok: boolean }>(
    async (_ctx, { movieId, watched }) => {
      if (watched) await markWatched(movieId);
      else await unmarkWatched(movieId);
      return { ok: true };
    }
  ),
};
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: errors are *only* the pre-existing ones in `movies.tsx`, `movie.tsx`, and `server.tsx` (the `clientLoader` and glob-typing issues that Task 6 fixes). No new errors from this file.

Note: this task is grouped with Tasks 6, 7, 8 for a single commit at the end of Task 8.

---

## Task 6: `movies.tsx` — remove `clientLoader`, add toggle UI

**Files:**
- Modify: `apps/app/src/pages/movies.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// apps/app/src/pages/movies.tsx
import {
  createCache,
  getLoaderData,
  type LoaderData,
  useAction,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { lazy, Route, Router } from 'preact-iso';
import type { MovieSummary, MoviesData } from '@/server/data/movies.js';
import serverLoader, { serverActions } from './movies.server.js';
import Noop from './noop.js';

type Data = { movies: MoviesData; watchedIds: number[] };

const cache = createCache<Data>('movies-list');

const Movie = lazy(() => import('./movie.js'));

const Movies: FunctionComponent<LoaderData<Data>> = (props) => {
  const initial = props.loaderData.watchedIds;
  const [watchedIds, setWatchedIds] = useState<number[]>(initial);

  const { mutate } = useAction(serverActions.toggleWatched, {
    onMutate: ({ movieId, watched }) => {
      const prev = watchedIds;
      setWatchedIds(
        watched ? [...prev, movieId] : prev.filter((id) => id !== movieId)
      );
      return prev;
    },
    onError: (_err, snapshot) => setWatchedIds(snapshot as number[]),
    invalidate: ['watched'],
  });

  const isWatched = (id: number) => watchedIds.includes(id);

  return (
    <section class="p-1">
      <a href="/" class="bg-amber-200">home</a>{' '}
      <a href="/watched" class="bg-emerald-200">watched ({watchedIds.length})</a>

      <ul class="mt-2">
        {props.loaderData.movies.results.map((m: MovieSummary) => (
          <li key={m.id} class="border-2 m-1 p-1 flex items-center gap-2">
            <a href={`/movies/${m.id}`} class="flex-1">
              {m.title} {isWatched(m.id) && <span class="text-emerald-600">✓ watched</span>}
            </a>
            <button
              type="button"
              class="bg-blue-500 text-white px-2 py-1 text-sm"
              onClick={() => mutate({ movieId: m.id, watched: !isWatched(m.id) })}
            >
              {isWatched(m.id) ? 'Unwatch' : 'Mark watched'}
            </button>
          </li>
        ))}
      </ul>

      <Router>
        <Route path="/:id" component={Movie} />
        <Noop />
      </Router>
    </section>
  );
};
Movies.displayName = 'Movies';

const Page = getLoaderData(Movies, { serverLoader, cache });
(Page as unknown as { defaultProps: { route: string } }).defaultProps = { route: '/movies' };
export default Page;
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: errors limited to `movie.tsx` (still has `clientLoader`) and `server.tsx`'s glob typing if it persists. No errors in `movies.tsx`.

Note: this task is grouped with Tasks 5, 7, 8 for a single commit at the end of Task 8.

---

## Task 7: `movie.server.ts` — expose `watched` record and add three actions

**Files:**
- Modify: `apps/app/src/pages/movie.server.ts`

- [ ] **Step 1: Replace the file**

```ts
// apps/app/src/pages/movie.server.ts
import { getMovie } from '@/server/movies.js';
import { defineAction, type Loader } from '@hono-preact/iso';
import type { Movie } from '@/server/data/movie.js';
import {
  getWatched,
  markWatched,
  setNotes,
  setPhoto,
  unmarkWatched,
  type WatchedRecord,
} from '@/server/watched.js';

const serverLoader: Loader<{ movie: Movie | null; watched: WatchedRecord | null }> =
  async ({ location }) => {
    const idStr = location.pathParams.id;
    const id = Number(idStr);
    const [movie, watched] = await Promise.all([
      getMovie(idStr),
      Number.isFinite(id) ? getWatched(id) : Promise.resolve(null),
    ]);
    return { movie, watched };
  };

export default serverLoader;

export const serverActions = {
  toggleWatched: defineAction<{ movieId: number; watched: boolean }, { ok: boolean }>(
    async (_ctx, { movieId, watched }) => {
      if (watched) await markWatched(movieId);
      else await unmarkWatched(movieId);
      return { ok: true };
    }
  ),

  setNotes: defineAction<{ movieId: string; notes: string }, { ok: boolean }>(
    async (_ctx, { movieId, notes }) => {
      const id = Number(movieId);
      if (!Number.isFinite(id)) throw new Error('movieId must be numeric');
      await setNotes(id, notes);
      return { ok: true };
    }
  ),

  setPhoto: defineAction<{ movieId: string; photo: File }, { ok: boolean }>(
    async (_ctx, { movieId, photo }) => {
      const id = Number(movieId);
      if (!Number.isFinite(id)) throw new Error('movieId must be numeric');
      const buf = new Uint8Array(await photo.arrayBuffer());
      await setPhoto(id, {
        contentType: photo.type || 'application/octet-stream',
        bytes: buf,
        filename: photo.name,
      });
      return { ok: true };
    }
  ),
};
```

Note on payload typing: `<Form>` payloads come through as strings (or `File`s) because they're built from `FormData`. We type `movieId` as `string` and parse to `number` server-side rather than expecting the framework to coerce. This matches the framework's documented behavior.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: only the remaining `movie.tsx` errors (Task 8 fixes those).

Note: this task is grouped with Tasks 5, 6, 8 for a single commit at the end of Task 8.

---

## Task 8: `movie.tsx` — toggle, notes form, photo form, refresh

**Files:**
- Modify: `apps/app/src/pages/movie.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// apps/app/src/pages/movie.tsx
import {
  cacheRegistry,
  Form,
  getLoaderData,
  type LoaderData,
  useAction,
  useReload,
  type WrapperProps,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import type { Movie } from '@/server/data/movie.js';
import type { WatchedRecord } from '@/server/watched.js';
import serverLoader, { serverActions } from './movie.server.js';

type Data = { movie: Movie | null; watched: WatchedRecord | null };

const MovieDetail: FunctionComponent<LoaderData<Data>> = (props) => {
  const { movie, watched } = props.loaderData;
  if (!movie) return <p>Movie not found.</p>;

  const isWatched = !!watched && watched.watchedAt > 0;
  const movieIdStr = String(movie.id);

  const reload = useReload();

  const { mutate: toggle, pending: togglePending } = useAction(serverActions.toggleWatched, {
    invalidate: 'auto',
    onSuccess: () => {
      cacheRegistry.invalidate('movies-list');
      cacheRegistry.invalidate('watched');
    },
  });

  return (
    <section class="p-1 space-y-4">
      <a href="/movies" class="bg-red-200">movies</a>

      <header>
        <h1 class="text-xl font-semibold">{movie.title}</h1>
        {isWatched && (
          <p class="text-emerald-700">
            ✓ watched on {new Date(watched!.watchedAt).toLocaleDateString()}
          </p>
        )}
      </header>

      <div class="flex gap-2">
        <button
          type="button"
          class="bg-blue-500 text-white px-3 py-1"
          disabled={togglePending}
          onClick={() => toggle({ movieId: movie.id, watched: !isWatched })}
        >
          {isWatched ? 'Unwatch' : 'Mark watched'}
        </button>
        <button
          type="button"
          class="bg-gray-300 px-3 py-1"
          onClick={() => reload.reload()}
        >
          Refresh
        </button>
      </div>

      <section>
        <h2 class="font-semibold">Notes</h2>
        <Form
          action={serverActions.setNotes}
          invalidate="auto"
          onSuccess={() => cacheRegistry.invalidate('watched')}
          class="flex flex-col gap-2 mt-1"
        >
          <input type="hidden" name="movieId" value={movieIdStr} />
          <textarea
            name="notes"
            class="border p-1 w-full"
            rows={3}
            defaultValue={watched?.notes ?? ''}
          />
          <button type="submit" class="bg-blue-500 text-white px-3 py-1 self-start">
            Save notes
          </button>
        </Form>
      </section>

      <section>
        <h2 class="font-semibold">Memory photo</h2>
        {watched?.photo && (
          <img
            src={`/api/watched/${movie.id}/photo`}
            alt="memory"
            class="max-w-xs my-2"
          />
        )}
        <Form
          action={serverActions.setPhoto}
          invalidate="auto"
          onSuccess={() => cacheRegistry.invalidate('watched')}
          class="flex flex-col gap-2 mt-1"
        >
          <input type="hidden" name="movieId" value={movieIdStr} />
          <input type="file" name="photo" accept="image/*" />
          <button type="submit" class="bg-blue-500 text-white px-3 py-1 self-start">
            Upload photo
          </button>
        </Form>
      </section>
    </section>
  );
};
MovieDetail.displayName = 'MovieDetail';

function MovieWrapper(props: WrapperProps) {
  return <article {...props} />;
}

const Page = getLoaderData(MovieDetail, { serverLoader, Wrapper: MovieWrapper });
(Page as unknown as { defaultProps: { route: string } }).defaultProps = { route: '/movies/:id' };
export default Page;
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: PASS — `movies.tsx` and `movie.tsx` errors are gone. The `server.tsx` glob-typing error may persist; if so, leave for now and confirm at Task 12.

If the `server.tsx` glob error remains: the typing comes from `actionsHandler` accepting `LazyGlob | EagerGlob` from the `@hono-preact/server` package. The fix is unrelated to our changes — leave as-is unless it's a new error introduced by our edits.

- [ ] **Step 3: Ready to commit (Tasks 5-8 together)**

Suggested message: `feat(app): wire watched tracker into movies list and detail pages`.

---

## Task 9: `watched.server.ts` — loader + remove + bulk-import streaming

**Files:**
- Create: `apps/app/src/pages/watched.server.ts`

- [ ] **Step 1: Create the file**

```ts
// apps/app/src/pages/watched.server.ts
import { getMovie, getMovies } from '@/server/movies.js';
import { defineAction, type Loader } from '@hono-preact/iso';
import type { Movie } from '@/server/data/movie.js';
import {
  listWatched,
  markWatched,
  removeWatched,
} from '@/server/watched.js';

export type WireWatched = {
  movieId: number;
  watchedAt: number;
  notes: string;
  hasPhoto: boolean;
};
type Entry = { movie: Movie | null; watched: WireWatched };

const serverLoader: Loader<{ entries: Entry[] }> = async () => {
  const records = await listWatched();
  const entries: Entry[] = await Promise.all(
    records.map(async (w) => ({
      movie: await getMovie(String(w.movieId)),
      watched: {
        movieId: w.movieId,
        watchedAt: w.watchedAt,
        notes: w.notes,
        hasPhoto: w.photo !== undefined,
      },
    }))
  );
  return { entries };
};

export default serverLoader;

export const serverActions = {
  removeWatched: defineAction<{ movieId: number }, { ok: boolean }>(
    async (_ctx, { movieId }) => {
      await removeWatched(movieId);
      return { ok: true };
    }
  ),

  bulkImportWatched: defineAction<Record<string, never>, never>(async () => {
    const target = (await getMovies()).results.slice(0, 20);
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        let count = 0;
        for (const m of target) {
          await markWatched(m.id);
          count++;
          controller.enqueue(
            encoder.encode(JSON.stringify({ count, total: target.length }) + '\n')
          );
          await new Promise((r) => setTimeout(r, 150));
        }
        controller.close();
      },
    });
  }),
};
```

A note on the wire shape: photo bytes are `Uint8Array`s, which `JSON.stringify` would produce as `{}`. The component reads bytes via the `<img src=…>` GET route, not from `loaderData`. We expose only `hasPhoto: boolean` so the UI knows whether to render the `<img>`.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: no new errors in `watched.server.ts`.

---

## Task 10: `watched.tsx` — list page with bulk import and remove

**Files:**
- Create: `apps/app/src/pages/watched.tsx`

- [ ] **Step 1: Create the file**

```tsx
// apps/app/src/pages/watched.tsx
import {
  cacheRegistry,
  createCache,
  getLoaderData,
  type LoaderData,
  useAction,
  useReload,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import type { Movie } from '@/server/data/movie.js';
import serverLoader, {
  serverActions,
  type WireWatched,
} from './watched.server.js';

type Entry = { movie: Movie | null; watched: WireWatched };
type Data = { entries: Entry[] };

const cache = createCache<Data>('watched');

const WatchedPage: FunctionComponent<LoaderData<Data>> = (props) => {
  const initial = props.loaderData.entries;
  const [entries, setEntries] = useState<Entry[]>(initial);
  const [progress, setProgress] = useState<{ count: number; total: number } | null>(null);

  const reload = useReload();

  const { mutate: remove } = useAction(serverActions.removeWatched, {
    invalidate: 'auto',
    onMutate: ({ movieId }) => {
      const prev = entries;
      setEntries((cur) => cur.filter((e) => e.watched.movieId !== movieId));
      return prev;
    },
    onError: (_err, snapshot) => setEntries(snapshot as Entry[]),
    onSuccess: () => cacheRegistry.invalidate('movies-list'),
  });

  const { mutate: bulkImport, pending: importing } = useAction(
    serverActions.bulkImportWatched,
    {
      onChunk: (chunk) => {
        for (const line of chunk.split('\n')) {
          if (!line.trim()) continue;
          try {
            setProgress(JSON.parse(line) as { count: number; total: number });
          } catch {
            // ignore malformed line
          }
        }
      },
      onSuccess: () => {
        setProgress(null);
        cacheRegistry.invalidate('movies-list');
        reload.reload();
      },
    }
  );

  return (
    <section class="p-1 space-y-3">
      <a href="/movies" class="bg-amber-200">movies</a>

      <header class="flex items-center gap-3">
        <h1 class="text-xl font-semibold">Watched ({entries.length})</h1>
        <button
          type="button"
          class="bg-blue-500 text-white px-3 py-1"
          disabled={importing}
          onClick={() => bulkImport({})}
        >
          {importing ? 'Importing…' : 'Bulk-import next 20'}
        </button>
        {progress && (
          <span class="text-sm">
            {progress.count} / {progress.total}
          </span>
        )}
      </header>

      {entries.length === 0 ? (
        <p>Nothing here yet. Mark a movie as watched to populate this list.</p>
      ) : (
        <ul class="space-y-2">
          {entries.map((e) => (
            <li key={e.watched.movieId} class="border-2 p-2 flex items-start gap-3">
              {e.watched.hasPhoto && (
                <img
                  src={`/api/watched/${e.watched.movieId}/photo`}
                  alt=""
                  class="w-16 h-16 object-cover"
                />
              )}
              <div class="flex-1">
                <a href={`/movies/${e.watched.movieId}`} class="font-semibold">
                  {e.movie?.title ?? `Movie #${e.watched.movieId}`}
                </a>
                <p class="text-xs text-gray-600">
                  {e.watched.watchedAt > 0
                    ? `watched ${new Date(e.watched.watchedAt).toLocaleDateString()}`
                    : 'notes/photo only'}
                </p>
                {e.watched.notes && <p class="text-sm mt-1">{e.watched.notes}</p>}
              </div>
              <button
                type="button"
                class="bg-red-500 text-white px-2 py-1 text-sm"
                onClick={() => remove({ movieId: e.watched.movieId })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
WatchedPage.displayName = 'WatchedPage';

const Page = getLoaderData(WatchedPage, {
  serverLoader,
  cache,
  fallback: <p class="p-1">Loading watched list…</p>,
});
(Page as unknown as { defaultProps: { route: string } }).defaultProps = { route: '/watched' };
export default Page;
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: PASS for `watched.server.ts` and `watched.tsx` (and the rest of the app, given Tasks 5–8 already passed).

---

## Task 11: Register `/watched` route in `iso.tsx`

**Files:**
- Modify: `apps/app/src/iso.tsx`

- [ ] **Step 1: Add the lazy import and route**

After the existing `Movies` lazy import:

```ts
const Watched = lazy(() => import('./pages/watched.js'));
```

In the `<Router>` block, add a `<Route>` after the existing movies routes and before the MDX routes:

```tsx
<Route path="/watched" component={Watched} />
```

The full updated `Base` component:

```tsx
export const Base: FunctionComponent = () => {
  return (
    <Router onRouteChange={onRouteChange}>
      <Route path="/" component={Home} />
      <Route path="/test" component={Test} />
      <Route path="/movies" component={Movies} />
      <Route path="/movies/*" component={Movies} />
      <Route path="/watched" component={Watched} />
      {mdxRoutes.map(({ route, Component }) => (
        <Route path={route} component={Component} />
      ))}
      <NotFound />
    </Router>
  );
};
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: PASS — full app compiles clean.

- [ ] **Step 3: Ready to commit (Tasks 9-11 together)**

Suggested message: `feat(app): add /watched page with bulk-import streaming and remove`.

---

## Task 12: Fix stale `clientLoader` wording in actions docs

**Files:**
- Modify: `apps/app/src/pages/docs/actions.mdx`

- [ ] **Step 1: Edit the table row**

Line 89 currently reads:

```
| `invalidate` | `'auto' \| false \| string[]` | `'auto'` re-runs the page's `clientLoader`. `string[]` invalidates named caches on other pages. Default: `false`. |
```

Replace with:

```
| `invalidate` | `'auto' \| false \| string[]` | `'auto'` re-runs the page's `serverLoader` (via the `/__loaders` RPC in the browser). `string[]` invalidates named caches on other pages. Default: `false`. |
```

- [ ] **Step 2: Ready to commit**

Suggested message: `docs(actions): fix stale clientLoader wording`.

---

## Task 13: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Tests pass**

Run: `pnpm test`
Expected: PASS — 146 prior + 9 new = 155 tests passing.

- [ ] **Step 2: Type-check passes**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: PASS with no errors.

- [ ] **Step 3: Manual browser verification**

Run: `pnpm dev`. Open the printed URL in a browser. Walk through this checklist; report any failures back to the user before declaring done.

- [ ] Visit `/movies`. Click "Mark watched" on a movie — badge appears immediately (optimistic).
- [ ] Refresh the page — badge persists.
- [ ] Click the "watched (N)" link → navigate to `/watched`. Entry from step 1 appears.
- [ ] Click "Remove" on the `/watched` entry — disappears immediately.
- [ ] Navigate back to `/movies` — badge is gone (cache was invalidated).
- [ ] Click into a movie detail page (`/movies/:id`). Toggle watched, then click "Refresh" — current page reloads with updated state.
- [ ] Type in the notes textarea, click "Save notes". After save, navigate to `/watched` — the note appears (cross-page invalidation worked).
- [ ] Upload a small image with the photo form. After upload, the image renders on the detail page (via `/api/watched/:id/photo`). Navigate to `/watched` — thumbnail also appears.
- [ ] On `/watched`, click "Bulk-import next 20". Progress counter advances visibly. After completion, both `/watched` count and the next visit to `/movies` reflect 20 watched.
- [ ] Navigate between `/movies`, `/movies/:id`, `/watched` repeatedly — no console errors, no JSON-parse errors (this confirms `loadersHandler` is working).

- [ ] **Step 4: Stop the dev server and report**

Run: stop `pnpm dev` (Ctrl+C). Report success or list any failed checklist items.

---

## Out of scope (do not include)

- Authentication, server/client/action guards.
- Database persistence, photo size limits, content-type allow-listing.
- Multi-user separation.
- Pagination on `/watched`.
- Re-running the verification checklist with multiple browsers; one is sufficient for POC.
