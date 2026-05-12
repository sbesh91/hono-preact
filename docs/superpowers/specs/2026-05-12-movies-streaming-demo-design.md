# Movies-integrated streaming demo

**Status:** design (revised 2026-05-12)
**Author:** brainstormed 2026-05-12
**Replaces:** `/live-stats` synthetic ticker as the headline streaming-loader demo

## Revision (2026-05-12)

Mid-execution we hit a hard framework constraint: the vite `server-only` plugin only allows a fixed allowlist of named exports from `.server.*` files (`default, loader, serverGuards, serverActions, actionGuards`), and the server-side loader RPC keys by module path with one default loader per file. The original spec assumed multiple `defineLoader` exports per file would work; they don't.

The pivot:

- **Section A (detail page)** is redesigned to use **one** unified streaming loader that yields a cumulative `{ summary?, cast?, similar?, boxOffice? }` shape. Four sub-streams run inside that generator and tick at their own cadences, merged into a single output stream. The client renders four sections that conditionally show skeleton or data based on which fields are populated.
- **Section B (layout activity feed) is dropped from this PR.** It cannot fit single-loader-per-file cleanly without giving it a dedicated stub route, which is awkward. B is deferred until framework Gap 1 (public multi-loader API) lands.
- **Section C (streaming search)** is unchanged. It was always a single loader.

Tasks 1–6 from the original plan (re-exports, mock data, genre map) remain valid and are already merged on the branch. Tasks 7–22 are replaced by the revised plan.

## Goals

- Replace the synthetic `/live-stats` ticker with two coordinated streaming features on the movies surface.
- Show **four streaming sections** on `/movies/:id`, all flowing through one unified streaming loader. Each section has its own cadence (token-by-token, fast trickle, slow trickle, slow single) and its own skeleton-to-data transition.
- Show input-driven SSR streaming via URL-shareable search with progressive match-bucket reveal.
- Keep all data fully self-contained: no external APIs, no keys, no network during dev or CI.

## Non-goals

- Real backend integration (TMDB, LLMs, WebSockets, SSE).
- New framework primitives. The demo uses existing `defineLoader` plus the internal `<Loader>` component for multi-loader pages. Two related framework gaps are captured in memory and are out of scope for this PR.
- Preserving the current instant client-side filter UX on `/movies`. Section C explicitly replaces it.
- Mobile layout for the activity-feed panel. Desktop-first; hidden below the `md` breakpoint.

## Why

The current streaming demo is `/live-stats`: a synthetic counter that holds the SSR connection open for 30 seconds emitting `{ tick, visitors, load }`. It demonstrates that streaming loaders work but it tells no story about *why* streaming SSR is useful. Once v0.1 launches, this page is the first thing a curious reader hits, and "synthetic counter" undersells the framework.

The movies surface is the existing demo app's most-developed area (list, detail, watched, layout, optimistic mutations). Threading streaming into it produces a demo where streaming is the way the feature works, not a bolted-on showcase.

## Architecture overview

| Route | Change |
|---|---|
| `/movies` (list) | Existing `loader` becomes a streaming generator that buckets results when `?q=` is present; otherwise yields the full list once and returns. Filter input moves to URL-driven. |
| `/movies/:id` (detail) | Existing `loader` unchanged (instant title / watched / notes / photo). Four new streaming loaders added: `castLoader`, `similarLoader`, `summaryLoader`, `boxOfficeLoader`. |
| `/movies/*` layout | Adds a fixed right-side `<ActivityFeed>` anchored to a stable synthetic location so it does not restart on inner navigation. |
| `/live-stats` | Deleted (page, server file, route entry, doc references). |

All loaders are discovered through the existing `server:` declarations on routes. No new server-module files are added; the activity-feed loader piggybacks on `movies-list.server.ts` because layouts cannot declare a `server` module (`define-routes.tsx`: "layout cannot declare `server`").

Two framework wrinkles are accepted as workarounds in this PR:

1. Multi-loader pages import `<Loader>` from `@hono-preact/iso/internal`. The framework has no public multi-loader-per-page API yet.
2. The layout-anchored feed is given a synthetic constant location so its serialized location key never changes.

Both are captured in `project_streaming_loader_framework_gaps.md` and are intended to be brainstormed as framework features before v0.1 launch.

## Section A: detail-page enrichment (`/movies/:id`)

### Visual order

```
[ back to movies ]
Movie Title                                ✓ watched on 2025-...
[ Mark watched ]  [ Refresh ]
─────────────────────────────────────────────────────
AI summary                                 ← token-by-token, ~30ms/word, ~50 words
Cast                                       ← fast trickle, ~150ms/member, 6 members
Similar movies                             ← slow trickle, ~400ms/card, 4 cards
Box office                                 ← slow single chunk, ~2s
─────────────────────────────────────────────────────
Notes                                      ← existing, unchanged
Memory photo                               ← existing, unchanged
```

Order is descending visual weight: the highest-motion stream (token-by-token) is at the top so it is the first new thing a visitor sees. Existing user-interactive sections stay at the bottom so the streaming demo does not disrupt them.

### Mock data: procedural and deterministic

Hand-authoring cast and similar lists for every movie in the catalog is tedious and the demo does not need realism, it needs variety. Each datum is generated from the movie id (deterministic seed) so reloads are stable.

- `apps/app/src/server/data/cast.ts`: small actor-name pool + small role pool (`Lead`, `Co-lead`, `Supporting`, etc.). Seeded from `movieId`, generates 6 cast members.
- `apps/app/src/server/data/similar.ts`: picks 4 movies from the existing catalog whose `genre_ids` overlap most with the target movie, deterministic via id tiebreak.
- `apps/app/src/server/data/summaries.ts`: template-based (`"A {adjective} {genre-noun} that {verb-phrase}. Critics praised the {praise-target}; audiences {audience-reaction}."`), pools seeded by id, ~40-50 words.
- `apps/app/src/server/data/box-office.ts`: seeded synthesis of `budget`, `revenue`, `openingWeekend`, `screens`. Uses real `movie.budget` and `movie.revenue` from `movie.ts` when present, synthesizes when missing.

Total mock-data code: ~150 lines across four files. Trivially testable.

### Loaders (`apps/app/src/pages/movie.server.ts`)

The existing `loader` is unchanged. Four new named exports, each a `defineLoader` async generator yielding cumulative state so the client just calls `useData()`:

```ts
export const summaryLoader = defineLoader(async function* (ctx: LoaderCtx) {
  const id = ctx.location.pathParams.id;
  const full = generateSummary(id);
  let acc = '';
  for (const w of full.split(' ')) {
    if (ctx.signal.aborted) return;
    acc = acc ? `${acc} ${w}` : w;
    yield acc;
    await sleep(30);
  }
});

export const castLoader      = defineLoader(/* cumulative array, ~150ms/yield */);
export const similarLoader   = defineLoader(/* cumulative array, ~400ms/yield */);
export const boxOfficeLoader = defineLoader(async function* (ctx) {
  await sleep(2000);
  if (ctx.signal.aborted) return;
  yield generateBoxOffice(ctx.location.pathParams.id);
});
```

All four loaders are discovered through the existing `server: () => import('./movie.server.js')` entry on the `/movies/:id` route. The vite plugin transforms each `defineLoader` call to attach a `__moduleKey` for client-side RPC fetches on reload.

### Error demo

The `boxOfficeLoader` throws if `ctx.location.searchParams.demo === 'crash'`. Visiting `/movies/1241982?demo=crash` shows the error banner replacing just the box-office section while the other three sections render normally.

### Client wiring (`apps/app/src/pages/movie.tsx`)

The page component uses `useRoute()` (re-exported from `@hono-preact/iso`, see "Framework re-exports") and passes it to each streaming `<Loader>`. Per-section `<View>` subcomponents call `loader.useData()`, which reads the innermost `LoaderDataContext`, so each section reads its own loader's data:

```tsx
import { Loader } from '@hono-preact/iso/internal';
import { useRoute } from '@hono-preact/iso';

const MovieDetail: FunctionComponent = () => {
  const route = useRoute();
  const { movie, watched, watchedCount } = loader.useData();
  // ... existing instant content ...

  return (
    <section class="p-1 space-y-4">
      {/* existing back link, header, buttons */}

      <section>
        <h2 class="font-semibold">Summary</h2>
        <Loader loader={summaryLoader} location={route} fallback={<SummarySkeleton />}>
          <SummaryView />
        </Loader>
      </section>

      {/* Cast, Similar, BoxOffice: same shape */}

      {/* existing Notes + Photo sections */}
    </section>
  );
};
```

Each section's View component is a tiny consumer:

```tsx
const SummaryView = () => <p>{summaryLoader.useData()}</p>;
const CastView = () => {
  const cast = castLoader.useData();
  return <ul>{cast.map(c => <li key={c.name}>{c.name} · {c.role}</li>)}</ul>;
};
```

Per-section error surfaces via `loader.useError()` inside the View, so a mid-stream throw in one section does not blank out the others.

### Skeletons

- `SummarySkeleton`: three gray bars of varied widths.
- `CastSkeleton`: six rows of name + role gray placeholders.
- `SimilarSkeleton`: four poster-shaped gray cards in a grid.
- `BoxOfficeSkeleton`: three labeled stat boxes with `…` values.

All Tailwind, no animation library; `animate-pulse` on the gray blocks.

## Section B: live activity feed

### Visual

Right-side fixed panel visible on `md+` screens, hidden on smaller. Shows last 5 events newest-first plus a refresh button:

```
                                  ┌── Live activity ─────────  ↻ ──┐
                                  │ Sam watched Moana 2 · 2s        │
                                  │ Alex watched Gladiator II · 5s  │
                                  │ Priya watched Wicked · 8s       │
                                  │ Jules watched Heretic · 11s     │
                                  │ Riley watched The Wild Robot ·14│
                                  └──────────────────────────────────┘
```

Survives soft navigation between `/movies`, `/movies/:id`, and back: (a) the layout itself does not remount, (b) the `<Loader>` keys on a stable synthetic location so its location key never changes.

### SSR vs client cadence

Holding the SSR connection open for tens of seconds is bad on `/movies/*` because the same connection waits for the detail page's four loaders too. So the feed loader is deliberately short on the server:

- Server: yields 5 events at ~1s intervals, then ends. SSR connection extends by ~5s.
- Client: the feed is not truly continuous. Clicking the refresh button (`useReload()` from inside the feed's `<Loader>`) kicks off a fresh fetch of 5 more events.

Relative timestamps (`· 5s ago`) tick via `setInterval` even when no new events arrive, which keeps the "live" feel between refreshes.

### Files

**New: `apps/app/src/components/ActivityFeed.tsx`**

```tsx
import { useReload } from '@hono-preact/iso';
import { feedLoader } from '@/pages/movies-list.server.js';

export function ActivityFeed() {
  const events = feedLoader.useData(); // FeedEvent[]
  const { reload, reloading } = useReload();
  return (
    <aside class="hidden md:block fixed top-20 right-2 w-64 border bg-white p-2 shadow">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-sm">Live activity</h3>
        <button onClick={reload} disabled={reloading} class="text-xs">↻</button>
      </div>
      <ul class="text-sm mt-2 space-y-1">
        {events.slice(-5).reverse().map(e => (
          <li key={e.id}>
            <span class="font-medium">{e.user}</span> watched{' '}
            <a href={`/movies/${e.movieId}`} class="text-blue-600">{e.movieTitle}</a>
            <span class="text-xs text-gray-500"> · {formatRelative(e.at)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

**Mod: `apps/app/src/pages/movies-list.server.ts`** (the feed loader piggybacks here because layouts cannot declare `server`):

```ts
type FeedEvent = { id: number; user: string; movieId: number; movieTitle: string; at: number };

export const feedLoader = defineLoader<FeedEvent[]>(
  async function* (ctx: LoaderCtx): AsyncGenerator<FeedEvent[]> {
    const movies = (await getMovies()).results;
    const users = ['Alex', 'Sam', 'Priya', 'Jules', 'Riley'];
    let acc: FeedEvent[] = [];
    for (let i = 0; i < 5; i++) {
      if (ctx.signal.aborted) return;
      const u = users[Math.floor(Math.random() * users.length)];
      const m = movies[Math.floor(Math.random() * movies.length)];
      acc = [
        ...acc,
        { id: Date.now() + i, user: u, movieId: m.id, movieTitle: m.title, at: Date.now() },
      ];
      yield acc;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
);
```

The page-level `loader` and this `feedLoader` share the file; both get separate `__id` and `__moduleKey` slots via the vite plugin's per-`defineLoader-call` transform.

**Mod: `apps/app/src/pages/movies-layout.tsx`** mounts the feed at the layout level with a stable synthetic location:

```tsx
import { Loader } from '@hono-preact/iso/internal';
import { feedLoader } from './movies-list.server.js';
import { ActivityFeed } from '@/components/ActivityFeed.js';

// Module-level constant: same identity every render, so Loader's locationKey
// never changes and the feed does not restart on /movies <-> /movies/:id.
const STABLE_FEED_LOCATION = {
  path: '/__feed',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

export default function MoviesLayout({ children }: LayoutProps) {
  // ... existing badge state ...
  return (
    <WatchedBadgeContext.Provider value={badge}>
      <section class="p-1">
        <header>{/* SearchInput, watched badge, etc */}</header>
        <div class="mt-2">{children}</div>
        <Loader loader={feedLoader} location={STABLE_FEED_LOCATION} fallback={<ActivityFeedSkeleton />}>
          <ActivityFeed />
        </Loader>
      </section>
    </WatchedBadgeContext.Provider>
  );
}
```

`STABLE_FEED_LOCATION` is the workaround for framework gap #2 (route-keyed loaders). Once a "scope: 'layout'" or `independent` flag exists, this can be replaced.

## Section C: streaming search

### Data shape

The loader returns a discriminated union, branched on whether `q` is present:

```ts
type SearchResults =
  | { mode: 'list'; movies: MovieList; watchedIds: number[] }
  | {
      mode: 'buckets';
      query: string;
      buckets: {
        exact:          MovieSummary[];  // title.startsWith(q)
        titleSubstring: MovieSummary[];  // title.includes(q), not in exact
        overview:       MovieSummary[];  // overview.includes(q), not in title
        genre:          MovieSummary[];  // q matches a known genre name
      };
      watchedIds: number[];
    };
```

The UI branches on `mode`. When `mode === 'buckets'`, each yield grows the buckets cumulatively.

### Loader (`apps/app/src/pages/movies-list.server.ts`)

The existing `serverLoader` becomes an async generator:

```ts
const serverLoader = async function* (ctx: LoaderCtx): AsyncGenerator<SearchResults> {
  const q = (ctx.location.searchParams.q ?? '').trim();
  const [movies, watched] = await Promise.all([getMovies(), listWatched()]);
  const watchedIds = watched.map(w => w.movieId);

  if (!q) {
    yield { mode: 'list', movies, watchedIds };
    return;
  }

  if (q === 'crash') {
    yield { mode: 'buckets', query: q, buckets: emptyBuckets(), watchedIds };
    await sleep(300);
    throw new Error('Search index unavailable (demo)');
  }

  const norm = q.toLowerCase();
  const buckets = emptyBuckets();

  await sleep(150);
  if (ctx.signal.aborted) return;
  buckets.exact = movies.results.filter(m => m.title.toLowerCase().startsWith(norm));
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };

  await sleep(250);
  if (ctx.signal.aborted) return;
  const exactIds = new Set(buckets.exact.map(m => m.id));
  buckets.titleSubstring = movies.results.filter(
    m => !exactIds.has(m.id) && m.title.toLowerCase().includes(norm)
  );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };

  await sleep(350);
  if (ctx.signal.aborted) return;
  const titleIds = new Set([...exactIds, ...buckets.titleSubstring.map(m => m.id)]);
  buckets.overview = movies.results.filter(
    m => !titleIds.has(m.id) && m.overview.toLowerCase().includes(norm)
  );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };

  await sleep(450);
  if (ctx.signal.aborted) return;
  const seen = new Set([...titleIds, ...buckets.overview.map(m => m.id)]);
  const matchedGenreId = matchGenre(norm);
  buckets.genre = matchedGenreId == null
    ? []
    : movies.results.filter(m => !seen.has(m.id) && m.genre_ids.includes(matchedGenreId));
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };
};
```

`matchGenre(q)` is a small hardcoded map (`{ action: 28, drama: 18, comedy: 35, animation: 16, ... }`) covering the TMDB genres present in the catalog. Lives next to the loader.

### Filter input becomes URL-driven

The input today is in `movies-layout.tsx` driving a `useState` and a Context. The new version reads `q` from the URL and writes back via preact-iso's `useLocation().route(url, replace)`:

```tsx
function SearchInput() {
  const location = useLocation();
  const currentQ = (location.searchParams?.q ?? '') as string;
  const [draft, setDraft] = useState(currentQ);
  const debounced = useDebounce(draft, 250);

  useEffect(() => { setDraft(currentQ); }, [currentQ]); // back/forward sync

  useEffect(() => {
    if (debounced === currentQ) return;
    location.route(`/movies?q=${encodeURIComponent(debounced)}`, true /* replace */);
  }, [debounced, currentQ, location]);

  return (
    <input
      type="search"
      placeholder="Search movies…"
      value={draft}
      onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
      class="ml-auto border px-2 py-1"
      aria-label="Search movies"
    />
  );
}
```

`useDebounce` is a six-line local helper in the same file; not added to the framework.

The layout drops `MoviesFilterContext` and `useMoviesFilter` entirely. `WatchedBadgeContext` stays unchanged. The header just renders `<SearchInput />` where the old input was.

**Cross-route behavior:** typing on `/movies/:id` debounce-navigates to `/movies?q=…`, which acts as "search from anywhere on /movies/*". Internal links from search results to `/movies/:id` drop `q` from the URL; browser back restores the search.

### Page rendering (`apps/app/src/pages/movies-list.tsx`)

```tsx
const MoviesList: FunctionComponent = () => {
  const data = loader.useData();
  const error = loader.useError();
  const { setCount } = useWatchedBadge();

  const { mutate, value: optimisticWatchedIds } = useOptimisticAction(
    serverActions.toggleWatched,
    {
      base: data.watchedIds,
      apply: (current, payload) =>
        payload.watched
          ? [...current, payload.movieId]
          : current.filter(id => id !== payload.movieId),
      invalidate: [loader, watchedLoader],
    }
  );

  useEffect(() => { setCount(optimisticWatchedIds.length); }, [optimisticWatchedIds.length, setCount]);
  const watched = new Set(optimisticWatchedIds);

  return (
    <>
      {error && <p class="text-red-700 bg-red-100 p-2">Search failed: {error.message}</p>}
      {data.mode === 'list' ? (
        <MovieList movies={data.movies.results} watched={watched} onToggle={mutate} />
      ) : (
        <SearchBuckets query={data.query} buckets={data.buckets} watched={watched} onToggle={mutate} />
      )}
    </>
  );
};
```

`<SearchBuckets>` renders four labeled sections (`Exact matches`, `Title contains`, `Overview mentions`, `Genre`), skipping empties. Each row uses the same list-item markup as today so mark/unmark optimism is preserved.

Optimistic mutations, badge sync, and reload invalidation all continue to work because `watchedIds` is in every yield.

## Section D: delete `/live-stats`

**Remove:**
- `apps/app/src/pages/live-stats.tsx`
- `apps/app/src/pages/live-stats.server.ts`
- The `/live-stats` entry in `apps/app/src/routes.ts`.

**Update `apps/app/src/pages/docs/streaming.mdx`:**
- Line 58 ("See `/live-stats` for a running example…") replaced with references to `/movies/:id` (multi-loader, varied shapes) and `/movies?q=…` (input-driven streaming).
- Line 157 (`curl -N http://localhost:5173/live-stats`) replaced with `curl -N 'http://localhost:5173/movies/1241982'`, which shows the full multi-stream SSR output.

Historical spec/plan files under `docs/superpowers/specs/2026-05-11-streaming-loaders-and-actions-design.md` and the corresponding plan are not touched. They document the original streaming work as it was built; rewriting history is not useful.

## Framework re-exports

Add `useRoute` and `useLocation` to `packages/iso/src/index.ts` alongside the existing preact-iso passthroughs:

```ts
export { Route, Router, lazy, useLocation, useRoute } from 'preact-iso';
```

`useRoute` is needed by `movie.tsx` to plumb `location` into each nested `<Loader>`. `useLocation` is needed by `SearchInput` to read `searchParams.q` and call `route(url, replace)`. Straight passthroughs in the spirit of the existing three.

## Test plan

**Mock-data generators (`apps/app/src/server/data/__tests__/`):**
- `cast.test.ts`: `generateCast('1241982')` returns a deterministic 6-member array; same seed gives the same names.
- `similar.test.ts`: `pickSimilar('1241982')` returns 4 ids from the catalog, never includes the input id, deterministic.
- `summaries.test.ts`: `generateSummary('1241982')` returns a non-empty string; same id same output.
- `box-office.test.ts`: `generateBoxOffice('1241982')` returns a `{ budget, revenue, openingWeekend, screens }` shape; uses real `movie.budget` when present.

**Loaders (`apps/app/src/pages/__tests__/`):**
- `movie.server.test.ts`: drive each of `castLoader`, `similarLoader`, `summaryLoader`, `boxOfficeLoader` as async generators with a stub `LoaderCtx`, assert yields are cumulative and respect `ctx.signal.aborted`.
- `movies-list.server.test.ts`:
  - empty `q` yields `mode: 'list'` once and returns.
  - `q = 'moana'` yields 4 cumulative bucket snapshots in order (exact, then titleSubstring, then overview, then genre).
  - `q = 'crash'` yields once, then throws.
  - `feedLoader` yields 5 cumulative event arrays then returns.

**Components (`apps/app/src/pages/__tests__/`):**
- `movie.tsx`: render with the page-level `loader` stubbed and each streaming loader stubbed; assert each section renders its skeleton then its data on yield.
- `movies-list.tsx`: render with `mode: 'list'`, assert plain list; render with `mode: 'buckets'`, assert each non-empty bucket renders as a labeled section; render with `useError()` returning a non-null Error, assert the error banner appears.
- `ActivityFeed.tsx`: render with stubbed events, assert last 5 reversed appear; clicking refresh calls `reload()`.

**Layout integration:**
- `movies-layout.test.tsx`: assert the activity feed does not remount across `/movies` → `/movies/:id` → `/movies` navigation. Mirrors the PR #16 layout-stability test.

**SSR streaming (`packages/server/src/__tests__/render-stream.test.tsx`):**
- Request `/movies/1241982`, parse the streamed response, assert script tags appear for each of the four detail-page loaders plus the feed loader.
- Request `/movies?q=drama`, assert script tags appear for each bucket yield.

## Implementation ordering

Suggested sequence to keep the tree green at each commit:

1. **Framework re-exports** (`useRoute`, `useLocation`). Trivial; lands first and unblocks the rest.
2. **Mock-data generators + tests.** Pure functions, no framework interaction.
3. **Detail-page enrichment (A).** Add 4 loaders + page wiring + tests.
4. **Live activity feed (B).** Add `feedLoader`, `ActivityFeed`, layout mount, tests.
5. **Streaming search (C).** Rework movies-list loader + `SearchInput` + page rendering + tests.
6. **Delete `/live-stats`.** Last, after the new demos are functional, so we never briefly lose the "streaming loader example" reference.
7. **Doc updates.** Rewrite the `streaming.mdx` references.

Each step is reviewable on its own and leaves the app working.

## Open framework gaps (deferred follow-ups)

Captured in `project_streaming_loader_framework_gaps.md`:

1. **No public multi-loader-per-page API.** The demo imports `<Loader>` from `@hono-preact/iso/internal` and plumbs `useRoute()` location into each nested loader. Candidate shapes: `definePage({ loaders })`, a public `<RouteLoader>` component, or a clean `Loader` re-export. Brainstorm before picking.
2. **Loaders are route-keyed; no "independent" mode.** The activity feed is given a synthetic stable location so it does not restart on inner navigation. Candidate shapes: a `<Loader independent>` (or `keyBy="none"`) prop, a flag on `defineLoader({ scope: 'layout' | 'route' })`, or first-class layout loaders (loosen the current "layout cannot declare server" rule).

Both should be brainstormed and resolved before v0.1 launch (item 10 in `project_v01_sequencing`).

## Out of scope

- Public multi-loader API and layout-level loaders. See "Open framework gaps."
- Auto-reload on the activity feed. The knob is left off by default; trivial to add later.
- Genre map completeness. Common genres are hardcoded; rare ones will not be searchable until added.
- Mobile layout for the activity feed. Hidden below `md`; redesign separately if mobile becomes a goal.
- Real backend integration (TMDB, LLMs, WebSockets, SSE).
