# Movies-integrated streaming demo: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **2026-05-12 revision:** Tasks 1–6 (re-exports, mock data, genre map) are complete and merged on branch `feat/movies-streaming-demo`. Tasks 7–22 in the body of this document **are superseded** by the "Revised tasks (post-pivot)" section at the bottom of the file. Skip directly to that section when executing.

**Goal (revised):** Replace the synthetic `/live-stats` ticker with two coordinated streaming features on the movies surface: a unified streaming loader on `/movies/:id` that drives four sections (summary, cast, similar, box-office) at independent cadences, and bucketed URL-driven streaming search on `/movies`. Section B (layout activity feed) is deferred until framework Gap 1 lands.

**Architecture (revised):** One unified `defineLoader` async generator on `/movies/:id` yielding a cumulative `{ summary?, cast?, similar?, boxOffice? }` shape; client renders four sections that conditionally show skeleton or data. `serverLoader` on `/movies` rewritten as a generator that yields bucketed search results when `?q=` is present. The framework currently only supports one named loader (`loader` or `default`) per `.server.*` file; the unified-loader design works within that constraint.

**Tech Stack:** preact, preact-iso, hono, vite, vitest, @testing-library/preact, Tailwind. All loaders use the existing `defineLoader` + streaming-SSR infra from PR #18/#19/#20.

**Spec:** `docs/superpowers/specs/2026-05-12-movies-streaming-demo-design.md`

**Pre-flight:** Work on a fresh branch off `main` (`feat/movies-streaming-demo` or via `superpowers:using-git-worktrees`). The plan assumes you start with a green tree on `main`.

---

## File map

**New files (15):**
- `apps/app/src/server/data/cast.ts`
- `apps/app/src/server/data/__tests__/cast.test.ts`
- `apps/app/src/server/data/similar.ts`
- `apps/app/src/server/data/__tests__/similar.test.ts`
- `apps/app/src/server/data/summaries.ts`
- `apps/app/src/server/data/__tests__/summaries.test.ts`
- `apps/app/src/server/data/box-office.ts`
- `apps/app/src/server/data/__tests__/box-office.test.ts`
- `apps/app/src/server/data/genre-map.ts`
- `apps/app/src/components/ActivityFeed.tsx`
- `apps/app/src/components/__tests__/ActivityFeed.test.tsx`
- `apps/app/src/pages/__tests__/movie.server.test.ts`
- `apps/app/src/pages/__tests__/movies-list.server.test.ts`
- `apps/app/src/pages/__tests__/movies-list.test.tsx`
- `apps/app/src/pages/__tests__/movies-layout.test.tsx`

**Modified files (5):**
- `packages/iso/src/index.ts` (add re-exports)
- `apps/app/src/pages/movie.server.ts` (add 4 streaming loaders)
- `apps/app/src/pages/movie.tsx` (wire 4 streaming sections)
- `apps/app/src/pages/movies-list.server.ts` (rewrite loader as generator + add `feedLoader`)
- `apps/app/src/pages/movies-list.tsx` (branch on `data.mode`, add `SearchBuckets`)
- `apps/app/src/pages/movies-layout.tsx` (drop `MoviesFilterContext`, add `SearchInput`, mount `<ActivityFeed>`)
- `apps/app/src/pages/docs/streaming.mdx` (rewrite live-stats references)
- `apps/app/src/routes.ts` (remove `/live-stats`)

**Deleted files (2):**
- `apps/app/src/pages/live-stats.tsx`
- `apps/app/src/pages/live-stats.server.ts`

---

## Task 1: Re-export `useRoute` and `useLocation` from `@hono-preact/iso`

**Files:**
- Modify: `packages/iso/src/index.ts:9`
- Test: covered transitively by Task 10 (movie.tsx) and Task 15 (SearchInput). No dedicated test.

**Why:** Multi-loader pages need `useRoute()` to plumb location into nested `<Loader>`s. URL-driven search input needs `useLocation()` for `searchParams` reading and `route()` navigation. Both already exist in preact-iso; we re-export them alongside `Route, Router, lazy`.

- [ ] **Step 1: Add the re-exports**

Modify `packages/iso/src/index.ts` line 9:

```ts
// Routing primitives — trivial re-exports of preact-iso. Listed here so
// consumers have a single import surface for everything they need.
export { Route, Router, lazy, useLocation, useRoute } from 'preact-iso';
```

(replace the existing line 9 export, which currently reads `export { Route, Router, lazy } from 'preact-iso';`)

- [ ] **Step 2: Verify the build still passes**

```bash
pnpm -w build
```

Expected: builds without errors (the new re-exports compile cleanly because the source symbols exist in preact-iso).

- [ ] **Step 3: Verify the test suite still passes**

```bash
pnpm vitest run
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/index.ts
git commit -m "feat(iso): re-export useRoute and useLocation from preact-iso

Needed by the upcoming movies streaming demo: useRoute() for plumbing
location into nested <Loader>s on the detail page, useLocation() for
URL-driven search input."
```

---

## Task 2: Mock-data generator (cast)

**Files:**
- Create: `apps/app/src/server/data/cast.ts`
- Test: `apps/app/src/server/data/__tests__/cast.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/server/data/__tests__/cast.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateCast } from '../cast.js';

describe('generateCast', () => {
  it('returns 6 members for a known movie id', () => {
    const result = generateCast('1241982');
    expect(result).toHaveLength(6);
  });

  it('is deterministic for the same id', () => {
    const a = generateCast('1241982');
    const b = generateCast('1241982');
    expect(a).toEqual(b);
  });

  it('returns different rosters for different ids', () => {
    const a = generateCast('1241982');
    const b = generateCast('558449');
    expect(a).not.toEqual(b);
  });

  it('each member has name and role', () => {
    const result = generateCast('1241982');
    for (const m of result) {
      expect(typeof m.name).toBe('string');
      expect(m.name.length).toBeGreaterThan(0);
      expect(typeof m.role).toBe('string');
      expect(m.role.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/server/data/__tests__/cast.test.ts
```

Expected: FAIL with "Cannot find module '../cast.js'".

- [ ] **Step 3: Implement the generator**

Create `apps/app/src/server/data/cast.ts`:

```ts
export type CastMember = { name: string; role: string };

const NAMES = [
  'Auli\'i Cravalho', 'Dwayne Johnson', 'Awkwafina', 'Pedro Pascal',
  'Zendaya', 'Timothée Chalamet', 'Florence Pugh', 'Cynthia Erivo',
  'Ariana Grande', 'Hugh Grant', 'Anya Taylor-Joy', 'Paul Mescal',
  'Denzel Washington', 'Margot Robbie', 'Ryan Gosling', 'Emma Stone',
  'Lupita Nyong\'o', 'Daniel Kaluuya', 'Saoirse Ronan', 'Jacob Elordi',
];
const ROLES = ['Lead', 'Co-lead', 'Supporting', 'Antagonist', 'Mentor', 'Ensemble'];

/** Tiny deterministic 32-bit hash so we don't pull in a dep. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateCast(movieId: string): CastMember[] {
  const seed = hash(movieId);
  const out: CastMember[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const nameIdx = (seed + i * 2654435761) >>> 0;
    let pick = nameIdx % NAMES.length;
    while (used.has(NAMES[pick])) pick = (pick + 1) % NAMES.length;
    used.add(NAMES[pick]);
    const role = ROLES[i % ROLES.length];
    out.push({ name: NAMES[pick], role });
  }
  return out;
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/server/data/__tests__/cast.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/server/data/cast.ts apps/app/src/server/data/__tests__/cast.test.ts
git commit -m "feat(app): deterministic cast generator for movies demo data"
```

---

## Task 3: Mock-data generator (similar movies)

**Files:**
- Create: `apps/app/src/server/data/similar.ts`
- Test: `apps/app/src/server/data/__tests__/similar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/server/data/__tests__/similar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickSimilar } from '../similar.js';

describe('pickSimilar', () => {
  it('returns 4 ids for a known movie', () => {
    const result = pickSimilar('1241982');
    expect(result).toHaveLength(4);
  });

  it('never includes the input id', () => {
    const result = pickSimilar('1241982');
    expect(result).not.toContain(1241982);
  });

  it('is deterministic for the same id', () => {
    expect(pickSimilar('1241982')).toEqual(pickSimilar('1241982'));
  });

  it('all picks exist in the movies catalog', async () => {
    const { moviesData } = await import('../movies.js');
    const allIds = new Set(moviesData.results.map((m) => m.id));
    const result = pickSimilar('1241982');
    for (const id of result) {
      expect(allIds.has(id)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/server/data/__tests__/similar.test.ts
```

Expected: FAIL with "Cannot find module '../similar.js'".

- [ ] **Step 3: Implement the generator**

Create `apps/app/src/server/data/similar.ts`:

```ts
import { moviesData } from './movies.js';

/**
 * Pick 4 movies whose genre_ids overlap most with the target movie.
 * Deterministic: ties broken by id ascending.
 */
export function pickSimilar(movieId: string): number[] {
  const id = Number(movieId);
  const target = moviesData.results.find((m) => m.id === id);
  if (!target) return [];
  const targetGenres = new Set(target.genre_ids);

  const scored = moviesData.results
    .filter((m) => m.id !== id)
    .map((m) => {
      let overlap = 0;
      for (const g of m.genre_ids) if (targetGenres.has(g)) overlap++;
      return { id: m.id, overlap };
    });

  // Sort by overlap desc, then by id asc for stability.
  scored.sort((a, b) => b.overlap - a.overlap || a.id - b.id);

  return scored.slice(0, 4).map((s) => s.id);
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/server/data/__tests__/similar.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/server/data/similar.ts apps/app/src/server/data/__tests__/similar.test.ts
git commit -m "feat(app): genre-overlap similar-movies picker for demo data"
```

---

## Task 4: Mock-data generator (AI-style summaries)

**Files:**
- Create: `apps/app/src/server/data/summaries.ts`
- Test: `apps/app/src/server/data/__tests__/summaries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/server/data/__tests__/summaries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateSummary } from '../summaries.js';

describe('generateSummary', () => {
  it('returns a non-empty string', () => {
    expect(generateSummary('1241982').length).toBeGreaterThan(0);
  });

  it('is deterministic for the same id', () => {
    expect(generateSummary('1241982')).toEqual(generateSummary('1241982'));
  });

  it('returns different output for different ids', () => {
    expect(generateSummary('1241982')).not.toEqual(generateSummary('558449'));
  });

  it('is roughly 40-60 words', () => {
    const words = generateSummary('1241982').split(/\s+/).filter(Boolean);
    expect(words.length).toBeGreaterThanOrEqual(40);
    expect(words.length).toBeLessThanOrEqual(60);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/server/data/__tests__/summaries.test.ts
```

Expected: FAIL with "Cannot find module '../summaries.js'".

- [ ] **Step 3: Implement the generator**

Create `apps/app/src/server/data/summaries.ts`:

```ts
const ADJECTIVES = [
  'sweeping', 'intimate', 'electrifying', 'bittersweet', 'audacious',
  'tender', 'pulse-pounding', 'meditative', 'kaleidoscopic', 'unsparing',
];
const VERBS = [
  'follows', 'reimagines', 'chronicles', 'subverts', 'celebrates',
  'interrogates', 'reframes', 'unspools',
];
const PRAISE = [
  'lead performance', 'production design', 'sound mix',
  'practical effects', 'editing rhythm', 'climactic third act',
];
const REACTIONS = [
  'returned for repeat viewings', 'flooded social media with quotes',
  'kept it in theaters for months', 'made it the year\'s sleeper hit',
  'turned it into a TikTok phenomenon',
];
const FILLER = [
  'In a season crowded with sequels, it stands apart for its conviction.',
  'It earns its runtime without ever feeling slack.',
  'The result feels both classical and unmistakably contemporary.',
  'Few films this year have inspired stronger debate.',
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(arr: readonly T[], seed: number, offset: number): T {
  return arr[((seed + offset * 2654435761) >>> 0) % arr.length];
}

export function generateSummary(movieId: string): string {
  const s = hash(movieId);
  const adj = pick(ADJECTIVES, s, 0);
  const verb = pick(VERBS, s, 1);
  const praise = pick(PRAISE, s, 2);
  const reaction = pick(REACTIONS, s, 3);
  const filler1 = pick(FILLER, s, 4);
  const filler2 = pick(FILLER, s, 5);
  return (
    `A ${adj} drama that ${verb} a small ensemble across a single ` +
    `transformative year. Critics praised the ${praise}; audiences ${reaction}. ` +
    `${filler1} ${filler2}`
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/server/data/__tests__/summaries.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/server/data/summaries.ts apps/app/src/server/data/__tests__/summaries.test.ts
git commit -m "feat(app): template-based AI-style summary generator for demo data"
```

---

## Task 5: Mock-data generator (box office)

**Files:**
- Create: `apps/app/src/server/data/box-office.ts`
- Test: `apps/app/src/server/data/__tests__/box-office.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/server/data/__tests__/box-office.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateBoxOffice } from '../box-office.js';

describe('generateBoxOffice', () => {
  it('returns the expected shape', () => {
    const r = generateBoxOffice('1241982');
    expect(typeof r.budget).toBe('number');
    expect(typeof r.revenue).toBe('number');
    expect(typeof r.openingWeekend).toBe('number');
    expect(typeof r.screens).toBe('number');
  });

  it('is deterministic for the same id', () => {
    expect(generateBoxOffice('1241982')).toEqual(generateBoxOffice('1241982'));
  });

  it('uses real budget/revenue from movieData when present', () => {
    const r = generateBoxOffice('1241982');
    // 1241982 (Moana 2) is in the detailed catalog, so its budget/revenue
    // should match movieData rather than the synthesized fallback.
    expect(r.budget).toBeGreaterThan(0);
    expect(r.revenue).toBeGreaterThan(0);
  });

  it('synthesizes plausible values for ids not in movieData', () => {
    const r = generateBoxOffice('99999999');
    expect(r.budget).toBeGreaterThan(0);
    expect(r.revenue).toBeGreaterThan(0);
    expect(r.openingWeekend).toBeGreaterThan(0);
    expect(r.screens).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/server/data/__tests__/box-office.test.ts
```

Expected: FAIL with "Cannot find module '../box-office.js'".

- [ ] **Step 3: Implement the generator**

Create `apps/app/src/server/data/box-office.ts`:

```ts
import { movieData } from './movie.js';

export type BoxOfficeStats = {
  budget: number;
  revenue: number;
  openingWeekend: number;
  screens: number;
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateBoxOffice(movieId: string): BoxOfficeStats {
  const detail = movieData[movieId];
  const s = hash(movieId);

  const budget = detail?.budget && detail.budget > 0
    ? detail.budget
    : 50_000_000 + (s % 200) * 1_000_000;

  const revenue = detail?.revenue && detail.revenue > 0
    ? detail.revenue
    : Math.floor(budget * (1.2 + (s % 30) / 10));

  const openingWeekend = Math.floor(revenue * (0.15 + (s % 20) / 100));
  const screens = 2500 + (s % 1500);

  return { budget, revenue, openingWeekend, screens };
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/server/data/__tests__/box-office.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/server/data/box-office.ts apps/app/src/server/data/__tests__/box-office.test.ts
git commit -m "feat(app): box-office generator that prefers real budget/revenue when present"
```

---

## Task 6: Genre-name map (used by streaming search)

**Files:**
- Create: `apps/app/src/server/data/genre-map.ts`
- Test: covered transitively by Task 13 (movies-list.server). No dedicated test.

**Why:** TMDB movie records carry `genre_ids` but no genre names. The streaming-search bucket for "genre matches" needs a name→id map so that `q = "drama"` can match movies with `genre_ids: [18, ...]`.

- [ ] **Step 1: Implement the map and lookup**

Create `apps/app/src/server/data/genre-map.ts`:

```ts
// TMDB canonical genre id mapping. Names are lowercase; lookup is exact-match
// against the trimmed query. Synonyms ('sci-fi' / 'science fiction') alias to
// the same id.
const GENRE_BY_NAME: Record<string, number> = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  'sci-fi': 878,
  'science fiction': 878,
  thriller: 53,
  war: 10752,
  western: 37,
};

/** Returns the TMDB genre id if `q` matches a known genre name, else null. */
export function matchGenre(q: string): number | null {
  return GENRE_BY_NAME[q.trim().toLowerCase()] ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/app/src/server/data/genre-map.ts
git commit -m "feat(app): genre-name to TMDB-id map for streaming search bucket"
```

---

## Task 7: Detail-page loader (`summaryLoader`)

**Files:**
- Modify: `apps/app/src/pages/movie.server.ts`
- Test: `apps/app/src/pages/__tests__/movie.server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/pages/__tests__/movie.server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { summaryLoader } from '../movie.server.js';
import type { RouteHook } from 'preact-iso';

const locFor = (id: string) =>
  ({
    path: `/movies/${id}`,
    pathParams: { id },
    searchParams: {},
  } as unknown as RouteHook);

describe('summaryLoader', () => {
  it('yields a growing string token by token', async () => {
    const ac = new AbortController();
    const gen = summaryLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    const yields: string[] = [];
    for await (const v of gen as AsyncGenerator<string>) {
      yields.push(v);
      if (yields.length >= 5) break;
    }
    expect(yields.length).toBe(5);
    for (let i = 1; i < yields.length; i++) {
      // Each yield should be longer (or equal) than the previous: it's accumulating.
      expect(yields[i].length).toBeGreaterThanOrEqual(yields[i - 1].length);
      // And the previous should be a prefix of the next.
      expect(yields[i].startsWith(yields[i - 1])).toBe(true);
    }
  });

  it('respects signal.aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const gen = summaryLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    const step = await (gen as AsyncGenerator<string>).next();
    expect(step.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.server.test.ts
```

Expected: FAIL with "summaryLoader is not exported" or similar.

- [ ] **Step 3: Add the loader**

Modify `apps/app/src/pages/movie.server.ts` by appending after the existing `serverActions` export:

```ts
import { generateSummary } from '@/server/data/summaries.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const summaryLoader = defineLoader<string>(
  async function* (ctx: LoaderCtx): AsyncGenerator<string> {
    const id = ctx.location.pathParams.id;
    if (!id) return;
    const full = generateSummary(id);
    let acc = '';
    for (const w of full.split(' ')) {
      if (ctx.signal.aborted) return;
      acc = acc ? `${acc} ${w}` : w;
      yield acc;
      await sleep(30);
    }
  }
);
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.server.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movie.server.ts apps/app/src/pages/__tests__/movie.server.test.ts
git commit -m "feat(app): summaryLoader streams AI-style blurb token-by-token"
```

---

## Task 8: Detail-page loader (`castLoader`)

**Files:**
- Modify: `apps/app/src/pages/movie.server.ts`
- Test: append to `apps/app/src/pages/__tests__/movie.server.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/app/src/pages/__tests__/movie.server.test.ts`:

```ts
import { castLoader } from '../movie.server.js';
import type { CastMember } from '@/server/data/cast.js';

describe('castLoader', () => {
  it('yields cumulative cast arrays', async () => {
    const ac = new AbortController();
    const gen = castLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    const yields: CastMember[][] = [];
    for await (const v of gen as AsyncGenerator<CastMember[]>) {
      yields.push(v);
    }
    expect(yields).toHaveLength(6);
    for (let i = 0; i < yields.length; i++) {
      expect(yields[i]).toHaveLength(i + 1);
    }
  });

  it('respects signal.aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const gen = castLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    const step = await (gen as AsyncGenerator<CastMember[]>).next();
    expect(step.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.server.test.ts -t castLoader
```

Expected: FAIL with "castLoader is not exported".

- [ ] **Step 3: Add the loader**

Append to `apps/app/src/pages/movie.server.ts`:

```ts
import { generateCast, type CastMember } from '@/server/data/cast.js';

export const castLoader = defineLoader<CastMember[]>(
  async function* (ctx: LoaderCtx): AsyncGenerator<CastMember[]> {
    const id = ctx.location.pathParams.id;
    if (!id) return;
    const members = generateCast(id);
    let acc: CastMember[] = [];
    for (const m of members) {
      if (ctx.signal.aborted) return;
      acc = [...acc, m];
      yield acc;
      await sleep(150);
    }
  }
);
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.server.test.ts
```

Expected: 4 passed (2 from Task 7 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movie.server.ts apps/app/src/pages/__tests__/movie.server.test.ts
git commit -m "feat(app): castLoader fast-trickle-streams 6 cast members"
```

---

## Task 9: Detail-page loader (`similarLoader`)

**Files:**
- Modify: `apps/app/src/pages/movie.server.ts`
- Test: append to `apps/app/src/pages/__tests__/movie.server.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/app/src/pages/__tests__/movie.server.test.ts`:

```ts
import { similarLoader } from '../movie.server.js';
import type { MovieSummary } from '@/server/data/movies.js';

describe('similarLoader', () => {
  it('yields cumulative similar-movie arrays of length 1..4', async () => {
    const ac = new AbortController();
    const gen = similarLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    const yields: MovieSummary[][] = [];
    for await (const v of gen as AsyncGenerator<MovieSummary[]>) {
      yields.push(v);
    }
    expect(yields).toHaveLength(4);
    for (let i = 0; i < yields.length; i++) {
      expect(yields[i]).toHaveLength(i + 1);
    }
  });

  it('never includes the target movie in any yield', async () => {
    const ac = new AbortController();
    const gen = similarLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    for await (const arr of gen as AsyncGenerator<MovieSummary[]>) {
      for (const m of arr) expect(m.id).not.toBe(1241982);
    }
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.server.test.ts -t similarLoader
```

Expected: FAIL with "similarLoader is not exported".

- [ ] **Step 3: Add the loader**

Append to `apps/app/src/pages/movie.server.ts`:

```ts
import { pickSimilar } from '@/server/data/similar.js';
import { moviesData, type MovieSummary } from '@/server/data/movies.js';

export const similarLoader = defineLoader<MovieSummary[]>(
  async function* (ctx: LoaderCtx): AsyncGenerator<MovieSummary[]> {
    const id = ctx.location.pathParams.id;
    if (!id) return;
    const ids = pickSimilar(id);
    let acc: MovieSummary[] = [];
    for (const sid of ids) {
      if (ctx.signal.aborted) return;
      const m = moviesData.results.find((mv) => mv.id === sid);
      if (m) acc = [...acc, m];
      yield acc;
      await sleep(400);
    }
  }
);
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.server.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movie.server.ts apps/app/src/pages/__tests__/movie.server.test.ts
git commit -m "feat(app): similarLoader slow-trickle-streams 4 movie cards"
```

---

## Task 10: Detail-page loader (`boxOfficeLoader` + crash demo)

**Files:**
- Modify: `apps/app/src/pages/movie.server.ts`
- Test: append to `apps/app/src/pages/__tests__/movie.server.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/app/src/pages/__tests__/movie.server.test.ts`:

```ts
import { boxOfficeLoader } from '../movie.server.js';

describe('boxOfficeLoader', () => {
  it('yields exactly one chunk with stats', async () => {
    const ac = new AbortController();
    const gen = boxOfficeLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    const yields: unknown[] = [];
    for await (const v of gen as AsyncGenerator<unknown>) yields.push(v);
    expect(yields).toHaveLength(1);
    const stats = yields[0] as { budget: number; revenue: number };
    expect(stats.budget).toBeGreaterThan(0);
    expect(stats.revenue).toBeGreaterThan(0);
  });

  it('throws when searchParams.demo === "crash"', async () => {
    const ac = new AbortController();
    const loc = {
      path: '/movies/1241982',
      pathParams: { id: '1241982' },
      searchParams: { demo: 'crash' },
    } as unknown as Parameters<typeof boxOfficeLoader.fn>[0]['location'];
    const gen = boxOfficeLoader.fn({ location: loc, signal: ac.signal });
    await expect(async () => {
      for await (const _ of gen as AsyncGenerator<unknown>) { /* drain */ }
    }).rejects.toThrow(/box-office/i);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.server.test.ts -t boxOfficeLoader
```

Expected: FAIL with "boxOfficeLoader is not exported".

- [ ] **Step 3: Add the loader**

Append to `apps/app/src/pages/movie.server.ts`:

```ts
import { generateBoxOffice, type BoxOfficeStats } from '@/server/data/box-office.js';

export const boxOfficeLoader = defineLoader<BoxOfficeStats>(
  async function* (ctx: LoaderCtx): AsyncGenerator<BoxOfficeStats> {
    const id = ctx.location.pathParams.id;
    if (!id) return;
    await sleep(2000);
    if (ctx.signal.aborted) return;
    if (ctx.location.searchParams.demo === 'crash') {
      throw new Error('box-office service unavailable (demo)');
    }
    yield generateBoxOffice(id);
  }
);
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.server.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movie.server.ts apps/app/src/pages/__tests__/movie.server.test.ts
git commit -m "feat(app): boxOfficeLoader slow-single-chunk; ?demo=crash throws"
```

---

## Task 11: Detail-page UI integration

**Files:**
- Modify: `apps/app/src/pages/movie.tsx`
- Test: `apps/app/src/pages/__tests__/movie.test.tsx` (new)

This task wires four `<Loader>` sections into the detail page using the internal `<Loader>` component and `useRoute()` for location plumbing.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/pages/__tests__/movie.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import MoviePage from '../movie.js';
import {
  loader,
  summaryLoader,
  castLoader,
  similarLoader,
  boxOfficeLoader,
} from '../movie.server.js';

afterEach(() => {
  cleanup();
  loader.cache.invalidate();
  summaryLoader.cache.invalidate();
  castLoader.cache.invalidate();
  similarLoader.cache.invalidate();
  boxOfficeLoader.cache.invalidate();
});

describe('MoviePage streaming sections', () => {
  it('renders headings for all four streaming sections', async () => {
    // Stub the page loader so we don't drive the real movie/watched logic.
    vi.spyOn(loader, 'fn').mockImplementation(async () => ({
      movie: { id: 1241982, title: 'Moana 2', overview: '...' } as never,
      watched: null,
      watchedCount: 0,
    }));
    // Stub streaming loaders to yield one chunk each immediately.
    vi.spyOn(summaryLoader, 'fn').mockImplementation(
      async function* () { yield 'streamed summary text'; } as never
    );
    vi.spyOn(castLoader, 'fn').mockImplementation(
      async function* () { yield [{ name: 'Actor A', role: 'Lead' }]; } as never
    );
    vi.spyOn(similarLoader, 'fn').mockImplementation(
      async function* () { yield []; } as never
    );
    vi.spyOn(boxOfficeLoader, 'fn').mockImplementation(
      async function* () { yield { budget: 1, revenue: 2, openingWeekend: 3, screens: 4 }; } as never
    );

    render(
      <LocationProvider scope="/movies/1241982">
        <MoviePage path="/movies/:id" pathParams={{ id: '1241982' }} searchParams={{}} />
      </LocationProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Summary')).toBeInTheDocument();
      expect(screen.getByText('Cast')).toBeInTheDocument();
      expect(screen.getByText('Similar movies')).toBeInTheDocument();
      expect(screen.getByText('Box office')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.test.tsx
```

Expected: FAIL (no Summary/Cast/Similar/Box office headings; movie.tsx hasn't been updated yet).

- [ ] **Step 3: Update `movie.tsx` to render the four streaming sections**

Modify `apps/app/src/pages/movie.tsx` by replacing the existing imports and component body:

```tsx
// apps/app/src/pages/movie.tsx
import {
  definePage,
  Form,
  useAction,
  useOptimisticAction,
  useReload,
  useRoute,
  type WrapperProps,
} from '@hono-preact/iso';
import { Loader } from '@hono-preact/iso/internal';
import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import {
  loader,
  serverActions,
  summaryLoader,
  castLoader,
  similarLoader,
  boxOfficeLoader,
} from './movie.server.js';
import { loader as moviesListLoader } from './movies-list.server.js';
import { loader as watchedLoader } from './watched.server.js';
import { useWatchedBadge } from './movies-layout.js';

function MovieWrapper(props: WrapperProps) {
  return <article {...props} />;
}

const NotesForm: FunctionComponent<{
  movieIdStr: string;
  defaultNotes: string;
  movieKey: number;
}> = ({ movieIdStr, defaultNotes, movieKey }) => {
  const { mutate, pending } = useAction(serverActions.setNotes, {
    invalidate: [loader, watchedLoader],
  });
  return (
    <Form mutate={mutate} pending={pending} class="flex flex-col gap-2 mt-1">
      <input type="hidden" name="movieId" value={movieIdStr} />
      <textarea
        key={movieKey}
        name="notes"
        class="border p-1 w-full"
        rows={3}
        defaultValue={defaultNotes}
      />
      <button type="submit" class="bg-blue-500 text-white px-3 py-1 self-start">
        Save notes
      </button>
    </Form>
  );
};

const PhotoForm: FunctionComponent<{ movieIdStr: string }> = ({ movieIdStr }) => {
  const { mutate, pending } = useAction(serverActions.setPhoto, {
    invalidate: [loader, watchedLoader],
  });
  return (
    <Form mutate={mutate} pending={pending} class="flex flex-col gap-2 mt-1">
      <input type="hidden" name="movieId" value={movieIdStr} />
      <input type="file" name="photo" accept="image/*" />
      <button type="submit" class="bg-blue-500 text-white px-3 py-1 self-start">
        Upload photo
      </button>
    </Form>
  );
};

const SummaryView: FunctionComponent = () => {
  const text = summaryLoader.useData();
  return <p class="leading-relaxed">{text}</p>;
};

const CastView: FunctionComponent = () => {
  const cast = castLoader.useData();
  return (
    <ul class="space-y-1">
      {cast.map((c) => (
        <li key={c.name}>
          <span class="font-medium">{c.name}</span> · {c.role}
        </li>
      ))}
    </ul>
  );
};

const SimilarView: FunctionComponent = () => {
  const movies = similarLoader.useData();
  return (
    <ul class="grid grid-cols-2 md:grid-cols-4 gap-2">
      {movies.map((m) => (
        <li key={m.id} class="border p-2">
          <a href={`/movies/${m.id}`} class="font-medium">{m.title}</a>
        </li>
      ))}
    </ul>
  );
};

const BoxOfficeView: FunctionComponent = () => {
  const stats = boxOfficeLoader.useData();
  const fmt = (n: number) => `$${Math.round(n / 1_000_000)}M`;
  const error = boxOfficeLoader.useError();
  if (error) {
    return (
      <p class="text-red-700 bg-red-100 p-2">Box office unavailable: {error.message}</p>
    );
  }
  return (
    <dl class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div><dt class="text-xs text-gray-600">Budget</dt><dd>{fmt(stats.budget)}</dd></div>
      <div><dt class="text-xs text-gray-600">Revenue</dt><dd>{fmt(stats.revenue)}</dd></div>
      <div><dt class="text-xs text-gray-600">Opening weekend</dt><dd>{fmt(stats.openingWeekend)}</dd></div>
      <div><dt class="text-xs text-gray-600">Screens</dt><dd>{stats.screens.toLocaleString()}</dd></div>
    </dl>
  );
};

const SummarySkeleton = (
  <div class="space-y-2 animate-pulse">
    <div class="h-3 bg-gray-200 w-11/12" />
    <div class="h-3 bg-gray-200 w-10/12" />
    <div class="h-3 bg-gray-200 w-9/12" />
  </div>
);
const CastSkeleton = (
  <ul class="space-y-1 animate-pulse">
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <li key={i} class="h-4 bg-gray-200 w-1/3" />
    ))}
  </ul>
);
const SimilarSkeleton = (
  <ul class="grid grid-cols-2 md:grid-cols-4 gap-2 animate-pulse">
    {[0, 1, 2, 3].map((i) => (
      <li key={i} class="h-20 bg-gray-200" />
    ))}
  </ul>
);
const BoxOfficeSkeleton = (
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} class="h-12 bg-gray-200" />
    ))}
  </div>
);

const MovieDetail: FunctionComponent = () => {
  const route = useRoute();
  const { movie, watched, watchedCount } = loader.useData();
  const { setCount } = useWatchedBadge();

  useEffect(() => { setCount(watchedCount); }, [watchedCount, setCount]);

  if (!movie) return <p>Movie not found.</p>;

  const isWatched = !!watched && watched.watchedAt > 0;
  const movieIdStr = String(movie.id);

  const reload = useReload();
  const { mutate: toggle, value: isWatchedOpt } = useOptimisticAction(
    serverActions.toggleWatched,
    {
      base: isWatched,
      apply: (_current, payload) => payload.watched,
      invalidate: [loader, moviesListLoader, watchedLoader],
    }
  );

  const handleToggle = () => {
    const next = !isWatchedOpt;
    setCount((c) => (c == null ? c : next ? c + 1 : c - 1));
    toggle({ movieId: movie.id, watched: next });
  };

  return (
    <section class="p-1 space-y-4">
      <a href="/movies" class="bg-red-200">movies</a>

      <header>
        <h1 class="text-xl font-semibold">{movie.title}</h1>
        {isWatchedOpt && (
          <p class="text-emerald-700">
            ✓ watched
            {watched ? ` on ${new Date(watched.watchedAt).toLocaleDateString()}` : ''}
          </p>
        )}
      </header>

      <div class="flex gap-2">
        <button type="button" class="bg-blue-500 text-white px-3 py-1" onClick={handleToggle}>
          {isWatchedOpt ? 'Unwatch' : 'Mark watched'}
        </button>
        <button type="button" class="bg-gray-300 px-3 py-1" onClick={() => reload.reload()}>
          Refresh
        </button>
      </div>

      <section>
        <h2 class="font-semibold">Summary</h2>
        <Loader loader={summaryLoader} location={route} fallback={SummarySkeleton}>
          <SummaryView />
        </Loader>
      </section>

      <section>
        <h2 class="font-semibold">Cast</h2>
        <Loader loader={castLoader} location={route} fallback={CastSkeleton}>
          <CastView />
        </Loader>
      </section>

      <section>
        <h2 class="font-semibold">Similar movies</h2>
        <Loader loader={similarLoader} location={route} fallback={SimilarSkeleton}>
          <SimilarView />
        </Loader>
      </section>

      <section>
        <h2 class="font-semibold">Box office</h2>
        <Loader loader={boxOfficeLoader} location={route} fallback={BoxOfficeSkeleton}>
          <BoxOfficeView />
        </Loader>
      </section>

      <section>
        <h2 class="font-semibold">Notes</h2>
        <NotesForm movieIdStr={movieIdStr} defaultNotes={watched?.notes ?? ''} movieKey={movie.id} />
      </section>

      <section>
        <h2 class="font-semibold">Memory photo</h2>
        {watched?.photo && (
          <img src={`/api/watched/${movie.id}/photo`} alt="memory" class="max-w-xs my-2" />
        )}
        <PhotoForm movieIdStr={movieIdStr} />
      </section>
    </section>
  );
};
MovieDetail.displayName = 'MovieDetail';

export default definePage(MovieDetail, { loader, Wrapper: MovieWrapper });
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.test.tsx
```

Expected: 1 passed.

- [ ] **Step 5: Run the full suite to catch regressions**

```bash
pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/pages/movie.tsx apps/app/src/pages/__tests__/movie.test.tsx
git commit -m "feat(app): movie detail page wires 4 parallel streaming sections

Summary (token-by-token), Cast (fast trickle), Similar (slow trickle),
Box office (slow single chunk). Each section has its own skeleton,
its own error surface via loader.useError(), and renders alongside
the existing instant title/watched/notes/photo content."
```

---

## Task 12: Activity-feed loader (`feedLoader` in `movies-list.server.ts`)

**Files:**
- Modify: `apps/app/src/pages/movies-list.server.ts`
- Test: `apps/app/src/pages/__tests__/movies-list.server.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/pages/__tests__/movies-list.server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { feedLoader } from '../movies-list.server.js';
import type { RouteHook } from 'preact-iso';

const FEED_LOC = {
  path: '/__feed',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

describe('feedLoader', () => {
  it('yields 5 cumulative event arrays', async () => {
    const ac = new AbortController();
    const gen = feedLoader.fn({ location: FEED_LOC, signal: ac.signal });
    const yields: unknown[][] = [];
    for await (const v of gen as AsyncGenerator<unknown[]>) yields.push(v);
    expect(yields).toHaveLength(5);
    for (let i = 0; i < yields.length; i++) {
      expect(yields[i]).toHaveLength(i + 1);
    }
  });

  it('each event has the expected shape', async () => {
    const ac = new AbortController();
    const gen = feedLoader.fn({ location: FEED_LOC, signal: ac.signal });
    const first = await (gen as AsyncGenerator<unknown[]>).next();
    const events = first.value as Array<{
      id: number;
      user: string;
      movieId: number;
      movieTitle: string;
      at: number;
    }>;
    expect(events).toHaveLength(1);
    expect(typeof events[0].id).toBe('number');
    expect(typeof events[0].user).toBe('string');
    expect(typeof events[0].movieId).toBe('number');
    expect(typeof events[0].movieTitle).toBe('string');
    expect(typeof events[0].at).toBe('number');
    // Drain so the test exits.
    for await (const _ of gen as AsyncGenerator<unknown[]>) { /* drain */ }
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-list.server.test.ts
```

Expected: FAIL with "feedLoader is not exported".

- [ ] **Step 3: Add the feedLoader**

Modify `apps/app/src/pages/movies-list.server.ts` by appending:

```ts
import type { LoaderCtx } from '@hono-preact/iso';

export type FeedEvent = {
  id: number;
  user: string;
  movieId: number;
  movieTitle: string;
  at: number;
};

const FEED_USERS = ['Alex', 'Sam', 'Priya', 'Jules', 'Riley'];

export const feedLoader = defineLoader<FeedEvent[]>(
  async function* (ctx: LoaderCtx): AsyncGenerator<FeedEvent[]> {
    const movies = (await getMovies()).results;
    let acc: FeedEvent[] = [];
    for (let i = 0; i < 5; i++) {
      if (ctx.signal.aborted) return;
      const u = FEED_USERS[Math.floor(Math.random() * FEED_USERS.length)];
      const m = movies[Math.floor(Math.random() * movies.length)];
      acc = [
        ...acc,
        { id: Date.now() + i, user: u, movieId: m.id, movieTitle: m.title, at: Date.now() },
      ];
      yield acc;
      await new Promise<void>((r) => setTimeout(r, 1000));
    }
  }
);
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-list.server.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movies-list.server.ts apps/app/src/pages/__tests__/movies-list.server.test.ts
git commit -m "feat(app): feedLoader streams 5 simulated 'now watching' events"
```

---

## Task 13: `ActivityFeed` component

**Files:**
- Create: `apps/app/src/components/ActivityFeed.tsx`
- Test: `apps/app/src/components/__tests__/ActivityFeed.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/components/__tests__/ActivityFeed.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { Loader } from '@hono-preact/iso/internal';
import { ActivityFeed } from '../ActivityFeed.js';
import { feedLoader } from '@/pages/movies-list.server.js';
import type { RouteHook } from 'preact-iso';

const STABLE_LOC = {
  path: '/__feed',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

afterEach(() => {
  cleanup();
  feedLoader.cache.invalidate();
});

describe('ActivityFeed', () => {
  it('renders the heading and the last 5 events newest first', async () => {
    vi.spyOn(feedLoader, 'fn').mockImplementation(
      async function* () {
        yield [
          { id: 1, user: 'Alex', movieId: 1, movieTitle: 'M1', at: 1000 },
          { id: 2, user: 'Sam', movieId: 2, movieTitle: 'M2', at: 2000 },
          { id: 3, user: 'Priya', movieId: 3, movieTitle: 'M3', at: 3000 },
        ];
      } as never
    );

    render(
      <LocationProvider>
        <Loader loader={feedLoader} location={STABLE_LOC}>
          <ActivityFeed />
        </Loader>
      </LocationProvider>
    );

    await screen.findByText('Live activity');
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(3);
    // Newest (id 3) is rendered first after .reverse()
    expect(items[0].textContent).toContain('Priya');
    expect(items[0].textContent).toContain('M3');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/components/__tests__/ActivityFeed.test.tsx
```

Expected: FAIL with "Cannot find module '../ActivityFeed.js'".

- [ ] **Step 3: Implement the component**

Create `apps/app/src/components/ActivityFeed.tsx`:

```tsx
import type { FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useReload } from '@hono-preact/iso';
import { feedLoader, type FeedEvent } from '@/pages/movies-list.server.js';

function formatRelative(ts: number, now: number): string {
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return `${Math.floor(diffSec / 3600)}h ago`;
}

export const ActivityFeed: FunctionComponent = () => {
  const events: FeedEvent[] = feedLoader.useData();
  const { reload, reloading } = useReload();

  // Tick once a second so relative timestamps update between events.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const recent = events.slice(-5).reverse();

  return (
    <aside class="hidden md:block fixed top-20 right-2 w-64 border bg-white p-2 shadow">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-sm">Live activity</h3>
        <button
          type="button"
          onClick={reload}
          disabled={reloading}
          class="text-xs px-1"
          aria-label="Refresh feed"
        >
          ↻
        </button>
      </div>
      <ul class="text-sm mt-2 space-y-1">
        {recent.map((e) => (
          <li key={e.id}>
            <span class="font-medium">{e.user}</span> watched{' '}
            <a href={`/movies/${e.movieId}`} class="text-blue-600">{e.movieTitle}</a>
            <span class="text-xs text-gray-500"> · {formatRelative(e.at, now)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
};
ActivityFeed.displayName = 'ActivityFeed';

export const ActivityFeedSkeleton: FunctionComponent = () => (
  <aside class="hidden md:block fixed top-20 right-2 w-64 border bg-white p-2 shadow">
    <h3 class="font-semibold text-sm">Live activity</h3>
    <ul class="text-sm mt-2 space-y-1 animate-pulse">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} class="h-3 bg-gray-200 w-full" />
      ))}
    </ul>
  </aside>
);
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/components/__tests__/ActivityFeed.test.tsx
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/ActivityFeed.tsx apps/app/src/components/__tests__/ActivityFeed.test.tsx
git commit -m "feat(app): ActivityFeed renders last 5 feed events with refresh button"
```

---

## Task 14: Mount `ActivityFeed` in the movies layout

**Files:**
- Modify: `apps/app/src/pages/movies-layout.tsx`
- Test: `apps/app/src/pages/__tests__/movies-layout.test.tsx` (new)

Note: this task only adds the feed mount. The `SearchInput` refactor (which removes `MoviesFilterContext`) is Task 16. Until Task 16 lands, the layout still exposes `useMoviesFilter` and the existing search input.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/pages/__tests__/movies-layout.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import MoviesLayout from '../movies-layout.js';
import { feedLoader } from '../movies-list.server.js';

afterEach(() => {
  cleanup();
  feedLoader.cache.invalidate();
});

describe('MoviesLayout', () => {
  it('renders the activity feed aside', async () => {
    vi.spyOn(feedLoader, 'fn').mockImplementation(
      async function* () {
        yield [{ id: 1, user: 'Alex', movieId: 1, movieTitle: 'M1', at: Date.now() }];
      } as never
    );

    render(
      <LocationProvider>
        <MoviesLayout>
          <p>child</p>
        </MoviesLayout>
      </LocationProvider>
    );

    await screen.findByText('Live activity');
    expect(screen.getByText('child')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-layout.test.tsx
```

Expected: FAIL (no "Live activity" text).

- [ ] **Step 3: Update the layout to mount the feed**

Modify `apps/app/src/pages/movies-layout.tsx`. Keep the existing `MoviesFilterContext` and `WatchedBadgeContext` for now; just add the feed mount inside the existing layout body. Replace the entire file:

```tsx
import { createContext } from 'preact';
import { useContext, useMemo, useState } from 'preact/hooks';
import type { LayoutProps } from '@hono-preact/iso';
import type { RouteHook } from 'preact-iso';
import { Loader } from '@hono-preact/iso/internal';
import { feedLoader } from './movies-list.server.js';
import { ActivityFeed, ActivityFeedSkeleton } from '@/components/ActivityFeed.js';

type MoviesFilter = { query: string; setQuery: (q: string) => void };

const MoviesFilterContext = createContext<MoviesFilter>({
  query: '',
  setQuery: () => {},
});

export const useMoviesFilter = () => useContext(MoviesFilterContext);

type WatchedBadge = {
  count: number | null;
  setCount: (
    value: number | null | ((prev: number | null) => number | null)
  ) => void;
};

const WatchedBadgeContext = createContext<WatchedBadge>({
  count: null,
  setCount: () => {},
});

export const useWatchedBadge = () => useContext(WatchedBadgeContext);

// Module-level constant: same identity every render, so Loader's locationKey
// never changes and the feed does not restart on /movies <-> /movies/:id.
// Workaround for framework gap #2 (route-keyed loaders). See
// project_streaming_loader_framework_gaps memory.
const STABLE_FEED_LOCATION = {
  path: '/__feed',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

export default function MoviesLayout({ children }: LayoutProps) {
  const [query, setQuery] = useState('');
  const [count, setCount] = useState<number | null>(null);

  const filter = useMemo(() => ({ query, setQuery }), [query]);
  const badge = useMemo(() => ({ count, setCount }), [count]);

  return (
    <WatchedBadgeContext.Provider value={badge}>
      <MoviesFilterContext.Provider value={filter}>
        <section class="p-1">
          <header class="flex items-center gap-2">
            <a href="/" class="bg-amber-200">home</a>
            <a href="/watched" class="bg-emerald-200">
              watched ({count ?? '…'})
            </a>
            <input
              type="search"
              placeholder="Filter movies…"
              value={query}
              onInput={(e) =>
                setQuery((e.currentTarget as HTMLInputElement).value)
              }
              class="ml-auto border px-2 py-1"
              aria-label="Filter movies"
            />
          </header>
          <div class="mt-2">{children}</div>
          <Loader
            loader={feedLoader}
            location={STABLE_FEED_LOCATION}
            fallback={<ActivityFeedSkeleton />}
          >
            <ActivityFeed />
          </Loader>
        </section>
      </MoviesFilterContext.Provider>
    </WatchedBadgeContext.Provider>
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-layout.test.tsx
```

Expected: 1 passed.

- [ ] **Step 5: Run the full suite to catch regressions**

```bash
pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/pages/movies-layout.tsx apps/app/src/pages/__tests__/movies-layout.test.tsx
git commit -m "feat(app): mount ActivityFeed in movies layout with stable feed location"
```

---

## Task 15: Streaming search loader (rewrite `serverLoader` in `movies-list.server.ts`)

**Files:**
- Modify: `apps/app/src/pages/movies-list.server.ts`
- Test: append to `apps/app/src/pages/__tests__/movies-list.server.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/app/src/pages/__tests__/movies-list.server.test.ts`:

```ts
import { loader as listLoader } from '../movies-list.server.js';
import type { SearchResults } from '../movies-list.server.js';

const locFor = (q?: string) =>
  ({
    path: '/movies',
    pathParams: {},
    searchParams: q == null ? {} : { q },
  } as unknown as RouteHook);

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe('movies-list loader (streaming search)', () => {
  it('yields a single list-mode chunk when q is empty', async () => {
    const ac = new AbortController();
    const gen = listLoader.fn({ location: locFor(), signal: ac.signal });
    const yields = await drain(gen as AsyncGenerator<SearchResults>);
    expect(yields).toHaveLength(1);
    expect(yields[0].mode).toBe('list');
  });

  it('yields 4 cumulative bucket chunks for a non-empty q', async () => {
    const ac = new AbortController();
    const gen = listLoader.fn({ location: locFor('moana'), signal: ac.signal });
    const yields = await drain(gen as AsyncGenerator<SearchResults>);
    expect(yields).toHaveLength(4);
    for (const y of yields) expect(y.mode).toBe('buckets');
    // Buckets only ever grow (cumulative).
    let prevTotal = 0;
    for (const y of yields) {
      if (y.mode !== 'buckets') continue;
      const total =
        y.buckets.exact.length +
        y.buckets.titleSubstring.length +
        y.buckets.overview.length +
        y.buckets.genre.length;
      expect(total).toBeGreaterThanOrEqual(prevTotal);
      prevTotal = total;
    }
  });

  it('throws after yielding once when q === "crash"', async () => {
    const ac = new AbortController();
    const gen = listLoader.fn({ location: locFor('crash'), signal: ac.signal });
    const yields: SearchResults[] = [];
    let err: Error | null = null;
    try {
      for await (const v of gen as AsyncGenerator<SearchResults>) yields.push(v);
    } catch (e) {
      err = e as Error;
    }
    expect(yields).toHaveLength(1);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/search index/i);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-list.server.test.ts -t 'streaming search'
```

Expected: FAIL (loader is not yet a generator; `SearchResults` type not exported).

- [ ] **Step 3: Rewrite the loader**

Replace the entire body of `apps/app/src/pages/movies-list.server.ts` (preserving the new `feedLoader` and the existing `serverActions`):

```ts
// apps/app/src/pages/movies-list.server.ts
import { getMovies } from '@/server/movies.js';
import {
  defineAction,
  defineLoader,
  type LoaderCtx,
} from '@hono-preact/iso';
import { listWatched, markWatched, unmarkWatched } from '@/server/watched.js';
import type { MoviesData, MovieSummary } from '@/server/data/movies.js';
import { matchGenre } from '@/server/data/genre-map.js';

export type SearchResults =
  | { mode: 'list'; movies: MoviesData; watchedIds: number[] }
  | {
      mode: 'buckets';
      query: string;
      buckets: {
        exact: MovieSummary[];
        titleSubstring: MovieSummary[];
        overview: MovieSummary[];
        genre: MovieSummary[];
      };
      watchedIds: number[];
    };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const emptyBuckets = () => ({
  exact: [] as MovieSummary[],
  titleSubstring: [] as MovieSummary[],
  overview: [] as MovieSummary[],
  genre: [] as MovieSummary[],
});

const serverLoader = async function* (
  ctx: LoaderCtx
): AsyncGenerator<SearchResults> {
  const q = (ctx.location.searchParams.q ?? '').toString().trim();
  const [movies, watched] = await Promise.all([getMovies(), listWatched()]);
  const watchedIds = watched.map((w) => w.movieId);

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
  buckets.exact = movies.results.filter((m) =>
    m.title.toLowerCase().startsWith(norm)
  );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };

  await sleep(250);
  if (ctx.signal.aborted) return;
  const exactIds = new Set(buckets.exact.map((m) => m.id));
  buckets.titleSubstring = movies.results.filter(
    (m) => !exactIds.has(m.id) && m.title.toLowerCase().includes(norm)
  );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };

  await sleep(350);
  if (ctx.signal.aborted) return;
  const titleIds = new Set([
    ...exactIds,
    ...buckets.titleSubstring.map((m) => m.id),
  ]);
  buckets.overview = movies.results.filter(
    (m) => !titleIds.has(m.id) && m.overview.toLowerCase().includes(norm)
  );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };

  await sleep(450);
  if (ctx.signal.aborted) return;
  const seen = new Set([
    ...titleIds,
    ...buckets.overview.map((m) => m.id),
  ]);
  const matchedGenreId = matchGenre(norm);
  buckets.genre =
    matchedGenreId == null
      ? []
      : movies.results.filter(
          (m) => !seen.has(m.id) && m.genre_ids.includes(matchedGenreId)
        );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };
};

export default serverLoader;
export const loader = defineLoader<SearchResults>(serverLoader);

export const serverActions = {
  toggleWatched: defineAction<
    { movieId: number; watched: boolean },
    { ok: boolean }
  >(async (_ctx, { movieId, watched }) => {
    if (watched) await markWatched(movieId);
    else await unmarkWatched(movieId);
    return { ok: true };
  }),
};

// --- Activity feed (mounted by movies-layout) ---
export type FeedEvent = {
  id: number;
  user: string;
  movieId: number;
  movieTitle: string;
  at: number;
};

const FEED_USERS = ['Alex', 'Sam', 'Priya', 'Jules', 'Riley'];

export const feedLoader = defineLoader<FeedEvent[]>(
  async function* (ctx: LoaderCtx): AsyncGenerator<FeedEvent[]> {
    const movies = (await getMovies()).results;
    let acc: FeedEvent[] = [];
    for (let i = 0; i < 5; i++) {
      if (ctx.signal.aborted) return;
      const u = FEED_USERS[Math.floor(Math.random() * FEED_USERS.length)];
      const m = movies[Math.floor(Math.random() * movies.length)];
      acc = [
        ...acc,
        { id: Date.now() + i, user: u, movieId: m.id, movieTitle: m.title, at: Date.now() },
      ];
      yield acc;
      await new Promise<void>((r) => setTimeout(r, 1000));
    }
  }
);
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-list.server.test.ts
```

Expected: 5 passed (2 feed + 3 search).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movies-list.server.ts apps/app/src/pages/__tests__/movies-list.server.test.ts
git commit -m "feat(app): movies-list loader streams bucketed search results

When ?q is present, yields cumulative buckets (exact title, substring,
overview, genre) with artificial inter-bucket delays so streaming is
visible. q='crash' demos mid-stream error. Empty q yields a single
list-mode chunk and returns."
```

---

## Task 16: `SearchInput` and layout refactor (drop `MoviesFilterContext`)

**Files:**
- Modify: `apps/app/src/pages/movies-layout.tsx` (remove `MoviesFilterContext`, add `SearchInput`)
- Test: append to `apps/app/src/pages/__tests__/movies-layout.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/app/src/pages/__tests__/movies-layout.test.tsx`:

```tsx
import { fireEvent } from '@testing-library/preact';

describe('SearchInput in MoviesLayout', () => {
  it('renders a search input pre-filled from URL searchParams.q', async () => {
    vi.spyOn(feedLoader, 'fn').mockImplementation(
      async function* () { yield []; } as never
    );
    render(
      <LocationProvider>
        <MoviesLayout>
          <p>child</p>
        </MoviesLayout>
      </LocationProvider>
    );
    const input = await screen.findByLabelText(/search movies/i);
    expect((input as HTMLInputElement).value).toBe('');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-layout.test.tsx -t SearchInput
```

Expected: FAIL ("Filter movies…" placeholder still present, label is "Filter movies" not "Search movies").

- [ ] **Step 3: Rewrite the layout**

Replace `apps/app/src/pages/movies-layout.tsx` entirely:

```tsx
import { createContext } from 'preact';
import type { FunctionComponent } from 'preact';
import {
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'preact/hooks';
import type { LayoutProps } from '@hono-preact/iso';
import { useLocation } from '@hono-preact/iso';
import type { RouteHook } from 'preact-iso';
import { Loader } from '@hono-preact/iso/internal';
import { feedLoader } from './movies-list.server.js';
import { ActivityFeed, ActivityFeedSkeleton } from '@/components/ActivityFeed.js';

type WatchedBadge = {
  count: number | null;
  setCount: (
    value: number | null | ((prev: number | null) => number | null)
  ) => void;
};

const WatchedBadgeContext = createContext<WatchedBadge>({
  count: null,
  setCount: () => {},
});

export const useWatchedBadge = () => useContext(WatchedBadgeContext);

// Legacy no-op export retained for one commit so movies-list.tsx (rewritten
// in the next task) keeps compiling between Task 16 and Task 17. Removed
// at the end of Task 17 along with its sole caller.
export const useMoviesFilter = (): { query: string; setQuery: (q: string) => void } => ({
  query: '',
  setQuery: () => {},
});

const STABLE_FEED_LOCATION = {
  path: '/__feed',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

function useDebounce<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const SearchInput: FunctionComponent = () => {
  const location = useLocation();
  const currentQ = ((location.searchParams as Record<string, string>)?.q ?? '');
  const [draft, setDraft] = useState(currentQ);
  const debounced = useDebounce(draft, 250);

  // Back/forward navigation syncs the input.
  useEffect(() => { setDraft(currentQ); }, [currentQ]);

  // Debounced write: replace history entry so each keystroke does not
  // pollute the back stack.
  useEffect(() => {
    if (debounced === currentQ) return;
    const next = debounced
      ? `/movies?q=${encodeURIComponent(debounced)}`
      : '/movies';
    location.route(next, true);
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
};

export default function MoviesLayout({ children }: LayoutProps) {
  const [count, setCount] = useState<number | null>(null);
  const badge = useMemo(() => ({ count, setCount }), [count]);

  return (
    <WatchedBadgeContext.Provider value={badge}>
      <section class="p-1">
        <header class="flex items-center gap-2">
          <a href="/" class="bg-amber-200">home</a>
          <a href="/watched" class="bg-emerald-200">
            watched ({count ?? '…'})
          </a>
          <SearchInput />
        </header>
        <div class="mt-2">{children}</div>
        <Loader
          loader={feedLoader}
          location={STABLE_FEED_LOCATION}
          fallback={<ActivityFeedSkeleton />}
        >
          <ActivityFeed />
        </Loader>
      </section>
    </WatchedBadgeContext.Provider>
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-layout.test.tsx
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movies-layout.tsx apps/app/src/pages/__tests__/movies-layout.test.tsx
git commit -m "feat(app): movies layout uses URL-driven SearchInput

Replaces the layout-local MoviesFilterContext with a SearchInput that
reads ?q from the URL and debounces writes (replace=true) back to the
URL via useLocation().route(). MoviesFilterContext and useMoviesFilter
are removed; consumers in movies-list.tsx are updated in the next task."
```

---

## Task 17: Movies-list page renders bucketed search results

**Files:**
- Modify: `apps/app/src/pages/movies-list.tsx`
- Test: `apps/app/src/pages/__tests__/movies-list.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/pages/__tests__/movies-list.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import MoviesList from '../movies-list.js';
import { loader, feedLoader } from '../movies-list.server.js';
import { loader as watchedLoader } from '../watched.server.js';
import MoviesLayout from '../movies-layout.js';

afterEach(() => {
  cleanup();
  loader.cache.invalidate();
  feedLoader.cache.invalidate();
  watchedLoader.cache.invalidate();
});

describe('MoviesList branches on data.mode', () => {
  it('renders plain list when mode === "list"', async () => {
    vi.spyOn(loader, 'fn').mockImplementation(async function* () {
      yield {
        mode: 'list',
        movies: {
          page: 1,
          total_pages: 1,
          total_results: 1,
          results: [
            {
              id: 1,
              title: 'Moana 2',
              overview: '',
              release_date: '',
              vote_average: 0,
              vote_count: 0,
              poster_path: '',
              backdrop_path: '',
              genre_ids: [],
              popularity: 0,
              adult: false,
              original_language: 'en',
              original_title: '',
              video: false,
            },
          ],
        },
        watchedIds: [],
      };
    } as never);
    vi.spyOn(feedLoader, 'fn').mockImplementation(
      async function* () { yield []; } as never
    );

    render(
      <LocationProvider>
        <MoviesLayout>
          <MoviesList path="/movies" pathParams={{}} searchParams={{}} />
        </MoviesLayout>
      </LocationProvider>
    );

    await screen.findByText('Moana 2');
  });

  it('renders bucket headings when mode === "buckets"', async () => {
    vi.spyOn(loader, 'fn').mockImplementation(async function* () {
      yield {
        mode: 'buckets',
        query: 'moana',
        buckets: {
          exact: [
            {
              id: 1,
              title: 'Moana 2',
              overview: '',
              release_date: '',
              vote_average: 0,
              vote_count: 0,
              poster_path: '',
              backdrop_path: '',
              genre_ids: [],
              popularity: 0,
              adult: false,
              original_language: 'en',
              original_title: '',
              video: false,
            },
          ],
          titleSubstring: [],
          overview: [],
          genre: [],
        },
        watchedIds: [],
      };
    } as never);
    vi.spyOn(feedLoader, 'fn').mockImplementation(
      async function* () { yield []; } as never
    );

    render(
      <LocationProvider>
        <MoviesLayout>
          <MoviesList path="/movies" pathParams={{}} searchParams={{ q: 'moana' }} />
        </MoviesLayout>
      </LocationProvider>
    );

    await screen.findByText('Exact matches');
    expect(screen.getByText('Moana 2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-list.test.tsx
```

Expected: FAIL ("Exact matches" not rendered; component still uses `useMoviesFilter`).

- [ ] **Step 3: Rewrite the page**

Replace `apps/app/src/pages/movies-list.tsx` entirely:

```tsx
import { definePage, useOptimisticAction } from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import type { MovieSummary } from '@/server/data/movies.js';
import { loader, serverActions, type SearchResults } from './movies-list.server.js';
import { loader as watchedLoader } from './watched.server.js';
import { useWatchedBadge } from './movies-layout.js';

type ToggleFn = (payload: { movieId: number; watched: boolean }) => void;

const Row: FunctionComponent<{
  m: MovieSummary;
  watched: Set<number>;
  onToggle: ToggleFn;
}> = ({ m, watched, onToggle }) => (
  <li class="border-2 m-1 p-1 flex items-center gap-2">
    <a href={`/movies/${m.id}`} class="flex-1">
      {m.title}{' '}
      {watched.has(m.id) && <span class="text-emerald-600">✓ watched</span>}
    </a>
    <button
      type="button"
      class="bg-blue-500 text-white px-2 py-1 text-sm"
      onClick={() => onToggle({ movieId: m.id, watched: !watched.has(m.id) })}
    >
      {watched.has(m.id) ? 'Unwatch' : 'Mark watched'}
    </button>
  </li>
);

const Bucket: FunctionComponent<{
  title: string;
  movies: MovieSummary[];
  watched: Set<number>;
  onToggle: ToggleFn;
}> = ({ title, movies, watched, onToggle }) => {
  if (movies.length === 0) return null;
  return (
    <section class="mt-3">
      <h2 class="font-semibold">{title}</h2>
      <ul>
        {movies.map((m) => (
          <Row key={m.id} m={m} watched={watched} onToggle={onToggle} />
        ))}
      </ul>
    </section>
  );
};

const MoviesList: FunctionComponent = () => {
  const data = loader.useData() as SearchResults;
  const error = loader.useError();
  const { setCount } = useWatchedBadge();

  const { mutate, value: optimisticWatchedIds } = useOptimisticAction(
    serverActions.toggleWatched,
    {
      base: data.watchedIds,
      apply: (current, payload) =>
        payload.watched
          ? [...current, payload.movieId]
          : current.filter((id) => id !== payload.movieId),
      invalidate: [loader, watchedLoader],
    }
  );

  useEffect(() => {
    setCount(optimisticWatchedIds.length);
  }, [optimisticWatchedIds.length, setCount]);

  const watched = new Set(optimisticWatchedIds);

  return (
    <>
      {error && (
        <p class="text-red-700 bg-red-100 p-2 my-2">
          Search failed: {error.message}
        </p>
      )}
      {data.mode === 'list' ? (
        <ul class="mt-2">
          {data.movies.results.map((m) => (
            <Row key={m.id} m={m} watched={watched} onToggle={mutate} />
          ))}
        </ul>
      ) : (
        <>
          <p class="text-sm text-gray-600 mt-2">Results for "{data.query}"</p>
          <Bucket title="Exact matches"   movies={data.buckets.exact}          watched={watched} onToggle={mutate} />
          <Bucket title="Title contains"  movies={data.buckets.titleSubstring} watched={watched} onToggle={mutate} />
          <Bucket title="Overview mentions" movies={data.buckets.overview}     watched={watched} onToggle={mutate} />
          <Bucket title="Genre"           movies={data.buckets.genre}          watched={watched} onToggle={mutate} />
        </>
      )}
    </>
  );
};
MoviesList.displayName = 'MoviesList';

export default definePage(MoviesList, { loader });
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-list.test.tsx
```

Expected: 2 passed.

- [ ] **Step 5: Remove the legacy `useMoviesFilter` export from the layout**

`movies-list.tsx` no longer imports `useMoviesFilter`, so the legacy no-op export added in Task 16 can come out. In `apps/app/src/pages/movies-layout.tsx`, delete this block:

```ts
// Legacy no-op export retained for one commit so movies-list.tsx (rewritten
// in the next task) keeps compiling between Task 16 and Task 17. Removed
// at the end of Task 17 along with its sole caller.
export const useMoviesFilter = (): { query: string; setQuery: (q: string) => void } => ({
  query: '',
  setQuery: () => {},
});
```

- [ ] **Step 6: Run the full suite to catch regressions**

```bash
pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/pages/movies-list.tsx apps/app/src/pages/__tests__/movies-list.test.tsx apps/app/src/pages/movies-layout.tsx
git commit -m "feat(app): movies-list renders bucketed search results

Branches on data.mode: plain list when no query, four labeled bucket
sections when streaming search is active. Empty buckets are hidden.
Optimistic mark-watched flows unchanged. Also drops the legacy
useMoviesFilter no-op now that its only caller is gone."
```

---

## Task 18: Delete `/live-stats`

**Files:**
- Delete: `apps/app/src/pages/live-stats.tsx`
- Delete: `apps/app/src/pages/live-stats.server.ts`
- Modify: `apps/app/src/routes.ts`

- [ ] **Step 1: Delete the page files**

```bash
git rm apps/app/src/pages/live-stats.tsx apps/app/src/pages/live-stats.server.ts
```

- [ ] **Step 2: Remove the route entry**

Edit `apps/app/src/routes.ts` to remove the `/live-stats` block. The file becomes:

```ts
import { defineRoutes } from '@hono-preact/iso';

const docsView = () => import('./components/DocsRoute.js');

export default defineRoutes([
  { path: '/', view: () => import('./pages/home.js') },
  { path: '/test', view: () => import('./pages/test.js') },
  {
    path: '/movies',
    layout: () => import('./pages/movies-layout.js'),
    children: [
      {
        path: '',
        view: () => import('./pages/movies-list.js'),
        server: () => import('./pages/movies-list.server.js'),
      },
      {
        path: ':id',
        view: () => import('./pages/movie.js'),
        server: () => import('./pages/movie.server.js'),
      },
    ],
  },
  {
    path: '/watched',
    view: () => import('./pages/watched.js'),
    server: () => import('./pages/watched.server.js'),
  },
  {
    path: '/docs',
    view: docsView,
  },
  {
    path: '/docs/*',
    view: docsView,
  },
  {
    path: '*',
    view: () => import('./pages/not-found.js'),
  },
]);
```

- [ ] **Step 3: Verify tests still pass**

```bash
pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Verify the build still succeeds**

```bash
pnpm -w build
```

Expected: builds without errors.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/routes.ts
git commit -m "chore(app): delete /live-stats; movies surface is the canonical streaming demo"
```

---

## Task 19: Update streaming docs to reference the new demos

**Files:**
- Modify: `apps/app/src/pages/docs/streaming.mdx`

- [ ] **Step 1: Read the current references**

```bash
grep -n "live-stats" apps/app/src/pages/docs/streaming.mdx
```

Expected: two matches (around line 58 and line 157, per the spec).

- [ ] **Step 2: Update the running-example reference**

Edit the section around line 58 (currently "See `/live-stats` for a running example…"). Replace with:

```mdx
See `/movies/:id` for a running example: four parallel streaming sections
(token-by-token AI summary, fast-trickle cast, slow-trickle similar movies,
slow-single box office) plus a layout-anchored "Live activity" feed. See
`/movies?q=drama` for input-driven SSR streaming: the server yields match
buckets (exact title, substring, overview, genre) progressively as it scans
the catalog.
```

- [ ] **Step 3: Update the curl example**

Edit the section around line 157 (currently `curl -N http://localhost:5173/live-stats`). Replace with:

```
curl -N 'http://localhost:5173/movies/1241982'
```

- [ ] **Step 4: Verify the docs render**

```bash
pnpm vitest run
```

Expected: all tests pass (no test references the old text, but a regression here would surface).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/docs/streaming.mdx
git commit -m "docs: point streaming.mdx at /movies examples instead of /live-stats"
```

---

## Task 20: SSR integration smoke test

**Files:**
- Modify: `packages/server/src/__tests__/render-stream.test.tsx`

This task adds two server-render integration tests that exercise the new movies surface end-to-end and confirm the streaming SSR pipeline emits the expected per-loader script chunks.

- [ ] **Step 1: Read the existing tests to match the style**

```bash
head -80 packages/server/src/__tests__/render-stream.test.tsx
```

- [ ] **Step 2: Add the failing test**

Append to `packages/server/src/__tests__/render-stream.test.tsx`:

```tsx
import { definePage } from '@hono-preact/iso';
import { loader as moviesListLoader } from '../../../../apps/app/src/pages/movies-list.server.js';

describe('renderPage: movies-list streaming search SSR', () => {
  it('streams bucket chunks when q is present', async () => {
    const PageBody = () => {
      const data = moviesListLoader.useData() as { mode: string };
      return <p data-testid="mode">{data.mode}</p>;
    };
    const Page = definePage(PageBody, { loader: moviesListLoader });

    const app = new Hono();
    app.get('/movies', (c) =>
      renderPage(
        c,
        <Page path="/movies" pathParams={{}} searchParams={{ q: 'moana' }} />
      )
    );

    const res = await app.request('/movies?q=moana');
    const body = await readBody(res);
    expect(body).toContain('__HP_STREAM__');
    // The first chunk is baked into the initial render; the remaining
    // 3 bucket yields arrive as inline script pushes.
    const pushCount = (body.match(/__HP_STREAM__\.push/g) ?? []).length;
    expect(pushCount).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 3: Run the test, verify it passes**

```bash
pnpm vitest run packages/server/src/__tests__/render-stream.test.tsx
```

Expected: all tests pass, including the new one.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/__tests__/render-stream.test.tsx
git commit -m "test(server): SSR integration smoke for streaming search buckets"
```

---

## Task 21: Manual smoke check

This is a non-automated verification. Run it before opening the PR.

- [ ] **Step 1: Start the dev server**

```bash
pnpm -w dev
```

Wait for vite to print the local URL (likely `http://localhost:5173`).

- [ ] **Step 2: Verify the movie detail page streams**

Visit `http://localhost:5173/movies/1241982`. Expected:
- Title, watched controls, notes, and photo render instantly.
- Summary section starts empty (skeleton), then types in word-by-word over ~1.5s.
- Cast section starts empty, then fills row-by-row over ~1s.
- Similar movies section starts empty, then fills card-by-card over ~1.6s.
- Box office shows skeleton for ~2s, then a single chunk fills it.
- Right-side "Live activity" panel populates with 5 events over ~5s.

- [ ] **Step 3: Verify the crash demo**

Visit `http://localhost:5173/movies/1241982?demo=crash`. Expected:
- Summary, Cast, Similar render normally.
- Box office section shows the red error banner "Box office unavailable: box-office service unavailable (demo)" after ~2s.

- [ ] **Step 4: Verify streaming search**

Visit `http://localhost:5173/movies?q=drama`. Expected:
- "Results for 'drama'" appears immediately.
- Buckets fill in over ~1.2s: Exact matches → Title contains → Overview mentions → Genre.
- Empty buckets are hidden.

- [ ] **Step 5: Verify search input behavior**

On `/movies`, type "moana" letter by letter into the search input. Expected:
- URL updates to `/movies?q=moana` after ~250ms (debounced).
- Each keystroke does not pollute browser back history (replace-state).
- Hitting browser back returns to the prior route (not intermediate queries).

- [ ] **Step 6: Verify the layout-anchored feed survives navigation**

On `/movies`, wait until the activity feed has populated. Click into `/movies/:id`. Expected:
- The activity feed panel stays mounted, retains its events, and does not restart.

- [ ] **Step 7: Verify the crash search demo**

Visit `http://localhost:5173/movies?q=crash`. Expected:
- Empty bucket layout briefly appears, then a red "Search failed: Search index unavailable (demo)" banner.

- [ ] **Step 8: Stop the dev server**

```bash
# Ctrl-C the terminal where pnpm -w dev is running, or kill its process.
```

---

## Task 22: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/movies-streaming-demo
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(app): movies-integrated streaming demo" --body "$(cat <<'EOF'
## Summary
- Replaces the synthetic `/live-stats` ticker as the headline streaming demo.
- `/movies/:id` runs four parallel streaming loaders (cast, similar, AI-style summary, box office).
- `/movies/*` layout mounts a persistent activity feed with simulated events.
- `/movies?q=…` streams bucketed search results (exact title, substring, overview, genre).

## Notes
- Two framework gaps are intentionally accepted as workarounds (multi-loader public API; route-keyed loaders). Both are captured in memory; Gap 1 is queued as the next framework task.
- Spec: `docs/superpowers/specs/2026-05-12-movies-streaming-demo-design.md`
- Plan: `docs/superpowers/plans/2026-05-12-movies-streaming-demo.md`

## Test plan
- [x] `pnpm vitest run` passes all tests
- [x] `pnpm -w build` succeeds
- [x] Manual smoke check (see plan Task 21)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Capture the PR URL**

The `gh pr create` output prints the URL. Record it in the session for follow-up.

---

# Revised tasks (post-pivot, 2026-05-12)

The tasks above (7-22) hit a framework blocker. The revised tasks below replace them. Tasks 1-6 are unchanged and already done on the branch.

**Revised file map (delta from original):**
- The four `cast/similar/summary/box-office` loaders DO NOT live as separate `defineLoader` exports. They are merged into a single async generator that drives the existing page `loader` in `movie.server.ts`.
- `feedLoader`, `ActivityFeed`, and the layout feed mount are NOT added in this PR (deferred).
- `movies-list.server.ts` rewrites its `loader` only — no `feedLoader`.
- `movies-layout.tsx` only changes to add `SearchInput` and drop `MoviesFilterContext`.

---

## Task R7: Unified detail-page streaming loader

**Files:**
- Modify: `apps/app/src/pages/movie.server.ts` (replace existing page loader with streaming generator; same export name `loader`)
- Test: `apps/app/src/pages/__tests__/movie.server.test.ts` (new)

The existing page loader returns `{ movie, watched, watchedCount }`. We replace it with an async generator that yields a cumulative shape including those instant fields plus four streaming sections that fill in over time.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/pages/__tests__/movie.server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loader as movieLoader, type DetailStream } from '../movie.server.js';
import type { RouteHook } from 'preact-iso';

const locFor = (id: string, search: Record<string, string> = {}) =>
  ({
    path: `/movies/${id}`,
    pathParams: { id },
    searchParams: search,
  } as unknown as RouteHook);

describe('movie loader (unified streaming)', () => {
  it('first yield has movie/watched/watchedCount and empty streaming sections', async () => {
    const ac = new AbortController();
    const gen = movieLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    const first = await (gen as AsyncGenerator<DetailStream>).next();
    expect(first.done).toBe(false);
    const v = first.value!;
    expect(v.movie).not.toBeNull();
    expect(v.summary).toBe('');
    expect(v.cast).toEqual([]);
    expect(v.similar).toEqual([]);
    expect(v.boxOffice).toBeNull();
    ac.abort();
    // Drain so the test exits.
    try { for await (const _ of gen as AsyncGenerator<DetailStream>) { /* drain */ } } catch { /* ignore */ }
  });

  it('streaming yields accumulate non-empty fields and eventually populate all four', async () => {
    const ac = new AbortController();
    const gen = movieLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    let last: DetailStream | undefined;
    for await (const v of gen as AsyncGenerator<DetailStream>) last = v;
    expect(last).toBeDefined();
    expect(last!.summary.length).toBeGreaterThan(0);
    expect(last!.cast.length).toBe(6);
    expect(last!.similar.length).toBe(4);
    expect(last!.boxOffice).not.toBeNull();
  }, 15_000);

  it('throws when searchParams.demo === "crash"', async () => {
    const ac = new AbortController();
    const gen = movieLoader.fn({
      location: locFor('1241982', { demo: 'crash' }),
      signal: ac.signal,
    });
    await expect(async () => {
      for await (const _ of gen as AsyncGenerator<DetailStream>) { /* drain */ }
    }).rejects.toThrow(/box-office/i);
  }, 15_000);

  it('respects signal.aborted (no yields after abort)', async () => {
    const ac = new AbortController();
    ac.abort();
    const gen = movieLoader.fn({ location: locFor('1241982'), signal: ac.signal });
    const first = await (gen as AsyncGenerator<DetailStream>).next();
    expect(first.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.server.test.ts
```

Expected: FAIL with "DetailStream is not exported" or shape mismatch on first test.

- [ ] **Step 3: Replace `movie.server.ts`**

Overwrite `apps/app/src/pages/movie.server.ts` with this content. The existing `serverActions` (toggleWatched, setNotes, setPhoto) and the file's set of imports are preserved; the loader is rewritten as a generator yielding the unified `DetailStream` shape.

```ts
// apps/app/src/pages/movie.server.ts
import { getMovie } from '@/server/movies.js';
import {
  defineAction,
  defineLoader,
  type LoaderCtx,
} from '@hono-preact/iso';
import {
  getWatched,
  listWatched,
  markWatched,
  setNotes,
  setPhoto,
  unmarkWatched,
} from '@/server/watched.js';
import type { Movie } from '@/server/data/movie.js';
import type { MovieSummary } from '@/server/data/movies.js';
import { moviesData } from '@/server/data/movies.js';
import { generateCast, type CastMember } from '@/server/data/cast.js';
import { generateSummary } from '@/server/data/summaries.js';
import { pickSimilar } from '@/server/data/similar.js';
import { generateBoxOffice, type BoxOfficeStats } from '@/server/data/box-office.js';

type WatchedRecord = Awaited<ReturnType<typeof getWatched>>;

export type DetailStream = {
  movie: Movie | null;
  watched: WatchedRecord;
  watchedCount: number;
  summary: string;
  cast: CastMember[];
  similar: MovieSummary[];
  boxOffice: BoxOfficeStats | null;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const serverLoader = async function* (
  ctx: LoaderCtx
): AsyncGenerator<DetailStream> {
  if (ctx.signal.aborted) return;
  const id = ctx.location.pathParams.id;
  if (!id) return;

  const [movie, watched, allWatched] = await Promise.all([
    getMovie(id),
    Number.isFinite(Number(id)) ? getWatched(Number(id)) : Promise.resolve(null),
    listWatched(),
  ]);

  let state: DetailStream = {
    movie,
    watched,
    watchedCount: allWatched.length,
    summary: '',
    cast: [],
    similar: [],
    boxOffice: null,
  };
  yield state;

  // If the movie isn't in the catalog, there's nothing to stream.
  if (!movie) return;

  const summaryWords = generateSummary(id).split(' ');
  const castList = generateCast(id);
  const similarIds = pickSimilar(id);

  let summaryIdx = 0;
  let castIdx = 0;
  let similarIdx = 0;
  let boxOfficeDone = false;
  let tick = 0;
  const TICK_MS = 50;

  // Tick-based scheduler. Each section has its own cadence:
  //  - summary: 1 word per tick     (~50ms/word)
  //  - cast:    1 member per 3 ticks (~150ms)
  //  - similar: 1 movie per 8 ticks  (~400ms)
  //  - box office: single chunk at tick 40 (~2000ms)
  while (true) {
    if (ctx.signal.aborted) return;
    let changed = false;
    const next: DetailStream = { ...state };

    if (summaryIdx < summaryWords.length) {
      next.summary = next.summary
        ? `${next.summary} ${summaryWords[summaryIdx]}`
        : summaryWords[summaryIdx];
      summaryIdx++;
      changed = true;
    }

    if (castIdx < castList.length && tick % 3 === 0) {
      next.cast = [...next.cast, castList[castIdx]];
      castIdx++;
      changed = true;
    }

    if (similarIdx < similarIds.length && tick % 8 === 0) {
      const m = moviesData.results.find((x) => x.id === similarIds[similarIdx]);
      if (m) next.similar = [...next.similar, m];
      similarIdx++;
      changed = true;
    }

    if (!boxOfficeDone && tick >= 40) {
      if (ctx.location.searchParams.demo === 'crash') {
        throw new Error('box-office service unavailable (demo)');
      }
      next.boxOffice = generateBoxOffice(id);
      boxOfficeDone = true;
      changed = true;
    }

    if (changed) {
      state = next;
      yield state;
    }

    const allDone =
      summaryIdx >= summaryWords.length &&
      castIdx >= castList.length &&
      similarIdx >= similarIds.length &&
      boxOfficeDone;
    if (allDone) return;

    await sleep(TICK_MS);
    tick++;
  }
};

export default serverLoader;
export const loader = defineLoader<DetailStream>(serverLoader);

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

- [ ] **Step 4: Run, verify all 4 tests pass**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.server.test.ts
```

Expected: 4 passed. The "streaming yields accumulate" test takes ~2.5s because the generator runs through all ticks.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movie.server.ts apps/app/src/pages/__tests__/movie.server.test.ts
git commit -m "feat(app): unified movie detail loader streams 4 sections

One async generator yields a cumulative { movie, watched, watchedCount,
summary, cast, similar, boxOffice } shape. Each streaming section has
its own tick-based cadence so the four sections fill in at independently
visible rates. ?demo=crash throws when box-office tick fires.

Replaces the original plan of four separate defineLoader exports, which
hit the framework's one-loader-per-server-file constraint (see
project_streaming_loader_framework_gaps memory)."
```

---

## Task R8: Detail-page UI integration (single loader)

**Files:**
- Modify: `apps/app/src/pages/movie.tsx`
- Test: `apps/app/src/pages/__tests__/movie.test.tsx` (new)

Replaces the 4-Loader nesting with conditional rendering against fields of the unified `DetailStream`.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/pages/__tests__/movie.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import MoviePage from '../movie.js';
import { loader } from '../movie.server.js';

afterEach(() => {
  cleanup();
  loader.cache.invalidate();
});

describe('MoviePage streaming sections', () => {
  it('renders the four section headings and content from a single-yield mock', async () => {
    vi.spyOn(loader, 'fn').mockImplementation(
      async function* () {
        yield {
          movie: { id: 1241982, title: 'Moana 2', overview: '...' } as never,
          watched: null,
          watchedCount: 0,
          summary: 'streamed summary text',
          cast: [{ name: 'Actor A', role: 'Lead' }],
          similar: [],
          boxOffice: { budget: 1, revenue: 2, openingWeekend: 3, screens: 4 },
        };
      } as never
    );

    render(
      <LocationProvider scope="/movies/1241982">
        <MoviePage path="/movies/:id" pathParams={{ id: '1241982' }} searchParams={{}} />
      </LocationProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Summary')).toBeInTheDocument();
      expect(screen.getByText('Cast')).toBeInTheDocument();
      expect(screen.getByText('Similar movies')).toBeInTheDocument();
      expect(screen.getByText('Box office')).toBeInTheDocument();
      expect(screen.getByText('streamed summary text')).toBeInTheDocument();
      expect(screen.getByText(/Actor A/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.test.tsx
```

- [ ] **Step 3: Replace `movie.tsx`**

```tsx
// apps/app/src/pages/movie.tsx
import {
  definePage,
  Form,
  useAction,
  useOptimisticAction,
  useReload,
  type WrapperProps,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import { loader, serverActions, type DetailStream } from './movie.server.js';
import { loader as moviesListLoader } from './movies-list.server.js';
import { loader as watchedLoader } from './watched.server.js';
import { useWatchedBadge } from './movies-layout.js';

function MovieWrapper(props: WrapperProps) {
  return <article {...props} />;
}

const NotesForm: FunctionComponent<{
  movieIdStr: string;
  defaultNotes: string;
  movieKey: number;
}> = ({ movieIdStr, defaultNotes, movieKey }) => {
  const { mutate, pending } = useAction(serverActions.setNotes, {
    invalidate: [loader, watchedLoader],
  });
  return (
    <Form mutate={mutate} pending={pending} class="flex flex-col gap-2 mt-1">
      <input type="hidden" name="movieId" value={movieIdStr} />
      <textarea
        key={movieKey}
        name="notes"
        class="border p-1 w-full"
        rows={3}
        defaultValue={defaultNotes}
      />
      <button type="submit" class="bg-blue-500 text-white px-3 py-1 self-start">
        Save notes
      </button>
    </Form>
  );
};

const PhotoForm: FunctionComponent<{ movieIdStr: string }> = ({ movieIdStr }) => {
  const { mutate, pending } = useAction(serverActions.setPhoto, {
    invalidate: [loader, watchedLoader],
  });
  return (
    <Form mutate={mutate} pending={pending} class="flex flex-col gap-2 mt-1">
      <input type="hidden" name="movieId" value={movieIdStr} />
      <input type="file" name="photo" accept="image/*" />
      <button type="submit" class="bg-blue-500 text-white px-3 py-1 self-start">
        Upload photo
      </button>
    </Form>
  );
};

const SummarySection: FunctionComponent<{ summary: string }> = ({ summary }) => {
  if (!summary) {
    return (
      <div class="space-y-2 animate-pulse">
        <div class="h-3 bg-gray-200 w-11/12" />
        <div class="h-3 bg-gray-200 w-10/12" />
        <div class="h-3 bg-gray-200 w-9/12" />
      </div>
    );
  }
  return <p class="leading-relaxed">{summary}</p>;
};

const CastSection: FunctionComponent<{ cast: DetailStream['cast'] }> = ({ cast }) => {
  if (cast.length === 0) {
    return (
      <ul class="space-y-1 animate-pulse">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} class="h-4 bg-gray-200 w-1/3" />
        ))}
      </ul>
    );
  }
  return (
    <ul class="space-y-1">
      {cast.map((c) => (
        <li key={c.name}>
          <span class="font-medium">{c.name}</span> · {c.role}
        </li>
      ))}
    </ul>
  );
};

const SimilarSection: FunctionComponent<{ similar: DetailStream['similar'] }> = ({ similar }) => {
  if (similar.length === 0) {
    return (
      <ul class="grid grid-cols-2 md:grid-cols-4 gap-2 animate-pulse">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} class="h-20 bg-gray-200" />
        ))}
      </ul>
    );
  }
  return (
    <ul class="grid grid-cols-2 md:grid-cols-4 gap-2">
      {similar.map((m) => (
        <li key={m.id} class="border p-2">
          <a href={`/movies/${m.id}`} class="font-medium">{m.title}</a>
        </li>
      ))}
    </ul>
  );
};

const BoxOfficeSection: FunctionComponent<{
  boxOffice: DetailStream['boxOffice'];
  error: Error | null;
}> = ({ boxOffice, error }) => {
  if (error) {
    return (
      <p class="text-red-700 bg-red-100 p-2">Box office unavailable: {error.message}</p>
    );
  }
  if (!boxOffice) {
    return (
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} class="h-12 bg-gray-200" />
        ))}
      </div>
    );
  }
  const fmt = (n: number) => `$${Math.round(n / 1_000_000)}M`;
  return (
    <dl class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div><dt class="text-xs text-gray-600">Budget</dt><dd>{fmt(boxOffice.budget)}</dd></div>
      <div><dt class="text-xs text-gray-600">Revenue</dt><dd>{fmt(boxOffice.revenue)}</dd></div>
      <div><dt class="text-xs text-gray-600">Opening weekend</dt><dd>{fmt(boxOffice.openingWeekend)}</dd></div>
      <div><dt class="text-xs text-gray-600">Screens</dt><dd>{boxOffice.screens.toLocaleString()}</dd></div>
    </dl>
  );
};

const MovieDetail: FunctionComponent = () => {
  const data = loader.useData();
  const error = loader.useError();
  const { setCount } = useWatchedBadge();

  useEffect(() => { setCount(data.watchedCount); }, [data.watchedCount, setCount]);

  if (!data.movie) return <p>Movie not found.</p>;

  const isWatched = !!data.watched && data.watched.watchedAt > 0;
  const movieIdStr = String(data.movie.id);

  const reload = useReload();
  const { mutate: toggle, value: isWatchedOpt } = useOptimisticAction(
    serverActions.toggleWatched,
    {
      base: isWatched,
      apply: (_current, payload) => payload.watched,
      invalidate: [loader, moviesListLoader, watchedLoader],
    }
  );

  const handleToggle = () => {
    const next = !isWatchedOpt;
    setCount((c) => (c == null ? c : next ? c + 1 : c - 1));
    toggle({ movieId: data.movie!.id, watched: next });
  };

  return (
    <section class="p-1 space-y-4">
      <a href="/movies" class="bg-red-200">movies</a>

      <header>
        <h1 class="text-xl font-semibold">{data.movie.title}</h1>
        {isWatchedOpt && (
          <p class="text-emerald-700">
            ✓ watched
            {data.watched ? ` on ${new Date(data.watched.watchedAt).toLocaleDateString()}` : ''}
          </p>
        )}
      </header>

      <div class="flex gap-2">
        <button type="button" class="bg-blue-500 text-white px-3 py-1" onClick={handleToggle}>
          {isWatchedOpt ? 'Unwatch' : 'Mark watched'}
        </button>
        <button type="button" class="bg-gray-300 px-3 py-1" onClick={() => reload.reload()}>
          Refresh
        </button>
      </div>

      <section>
        <h2 class="font-semibold">Summary</h2>
        <SummarySection summary={data.summary} />
      </section>

      <section>
        <h2 class="font-semibold">Cast</h2>
        <CastSection cast={data.cast} />
      </section>

      <section>
        <h2 class="font-semibold">Similar movies</h2>
        <SimilarSection similar={data.similar} />
      </section>

      <section>
        <h2 class="font-semibold">Box office</h2>
        <BoxOfficeSection boxOffice={data.boxOffice} error={error} />
      </section>

      <section>
        <h2 class="font-semibold">Notes</h2>
        <NotesForm
          movieIdStr={movieIdStr}
          defaultNotes={data.watched?.notes ?? ''}
          movieKey={data.movie.id}
        />
      </section>

      <section>
        <h2 class="font-semibold">Memory photo</h2>
        {data.watched?.photo && (
          <img src={`/api/watched/${data.movie.id}/photo`} alt="memory" class="max-w-xs my-2" />
        )}
        <PhotoForm movieIdStr={movieIdStr} />
      </section>
    </section>
  );
};
MovieDetail.displayName = 'MovieDetail';

export default definePage(MovieDetail, { loader, Wrapper: MovieWrapper });
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movie.test.tsx
```

- [ ] **Step 5: Run the full suite, then build, to catch regressions and the previous build blocker**

```bash
pnpm vitest run
pnpm -w build
```

Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/pages/movie.tsx apps/app/src/pages/__tests__/movie.test.tsx
git commit -m "feat(app): movie detail UI renders unified streaming sections

Each of Summary, Cast, Similar movies, Box office is a small subcomponent
that renders skeleton-or-data based on the field state from the single
DetailStream. Box office surfaces loader.useError() so the ?demo=crash
flow still has a visible failure path. Notes and Memory photo (user-
interactive sections) remain at the bottom."
```

---

## Task R9: Streaming search loader rewrite (no feedLoader)

**Files:**
- Modify: `apps/app/src/pages/movies-list.server.ts`
- Test: `apps/app/src/pages/__tests__/movies-list.server.test.ts` (new)

Rewrites the existing list loader as a generator that yields the `SearchResults` discriminated union. **Does NOT** add a `feedLoader`.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/pages/__tests__/movies-list.server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loader as listLoader, type SearchResults } from '../movies-list.server.js';
import type { RouteHook } from 'preact-iso';

const locFor = (q?: string) =>
  ({
    path: '/movies',
    pathParams: {},
    searchParams: q == null ? {} : { q },
  } as unknown as RouteHook);

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe('movies-list loader (streaming search)', () => {
  it('yields a single list-mode chunk when q is empty', async () => {
    const ac = new AbortController();
    const gen = listLoader.fn({ location: locFor(), signal: ac.signal });
    const yields = await drain(gen as AsyncGenerator<SearchResults>);
    expect(yields).toHaveLength(1);
    expect(yields[0].mode).toBe('list');
  });

  it('yields 4 cumulative bucket chunks for a non-empty q', async () => {
    const ac = new AbortController();
    const gen = listLoader.fn({ location: locFor('moana'), signal: ac.signal });
    const yields = await drain(gen as AsyncGenerator<SearchResults>);
    expect(yields).toHaveLength(4);
    for (const y of yields) expect(y.mode).toBe('buckets');
    let prevTotal = 0;
    for (const y of yields) {
      if (y.mode !== 'buckets') continue;
      const total =
        y.buckets.exact.length +
        y.buckets.titleSubstring.length +
        y.buckets.overview.length +
        y.buckets.genre.length;
      expect(total).toBeGreaterThanOrEqual(prevTotal);
      prevTotal = total;
    }
  });

  it('throws after yielding once when q === "crash"', async () => {
    const ac = new AbortController();
    const gen = listLoader.fn({ location: locFor('crash'), signal: ac.signal });
    const yields: SearchResults[] = [];
    let err: Error | null = null;
    try {
      for await (const v of gen as AsyncGenerator<SearchResults>) yields.push(v);
    } catch (e) {
      err = e as Error;
    }
    expect(yields).toHaveLength(1);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/search index/i);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-list.server.test.ts
```

- [ ] **Step 3: Rewrite `movies-list.server.ts`**

```ts
// apps/app/src/pages/movies-list.server.ts
import { getMovies } from '@/server/movies.js';
import { defineAction, defineLoader, type LoaderCtx } from '@hono-preact/iso';
import { listWatched, markWatched, unmarkWatched } from '@/server/watched.js';
import type { MoviesData, MovieSummary } from '@/server/data/movies.js';
import { matchGenre } from '@/server/data/genre-map.js';

export type SearchResults =
  | { mode: 'list'; movies: MoviesData; watchedIds: number[] }
  | {
      mode: 'buckets';
      query: string;
      buckets: {
        exact: MovieSummary[];
        titleSubstring: MovieSummary[];
        overview: MovieSummary[];
        genre: MovieSummary[];
      };
      watchedIds: number[];
    };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const emptyBuckets = () => ({
  exact: [] as MovieSummary[],
  titleSubstring: [] as MovieSummary[],
  overview: [] as MovieSummary[],
  genre: [] as MovieSummary[],
});

const serverLoader = async function* (
  ctx: LoaderCtx
): AsyncGenerator<SearchResults> {
  const q = (ctx.location.searchParams.q ?? '').toString().trim();
  const [movies, watched] = await Promise.all([getMovies(), listWatched()]);
  const watchedIds = watched.map((w) => w.movieId);

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
  buckets.exact = movies.results.filter((m) =>
    m.title.toLowerCase().startsWith(norm)
  );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };

  await sleep(250);
  if (ctx.signal.aborted) return;
  const exactIds = new Set(buckets.exact.map((m) => m.id));
  buckets.titleSubstring = movies.results.filter(
    (m) => !exactIds.has(m.id) && m.title.toLowerCase().includes(norm)
  );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };

  await sleep(350);
  if (ctx.signal.aborted) return;
  const titleIds = new Set([
    ...exactIds,
    ...buckets.titleSubstring.map((m) => m.id),
  ]);
  buckets.overview = movies.results.filter(
    (m) => !titleIds.has(m.id) && m.overview.toLowerCase().includes(norm)
  );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };

  await sleep(450);
  if (ctx.signal.aborted) return;
  const seen = new Set([...titleIds, ...buckets.overview.map((m) => m.id)]);
  const matchedGenreId = matchGenre(norm);
  buckets.genre =
    matchedGenreId == null
      ? []
      : movies.results.filter(
          (m) => !seen.has(m.id) && m.genre_ids.includes(matchedGenreId)
        );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };
};

export default serverLoader;
export const loader = defineLoader<SearchResults>(serverLoader);

export const serverActions = {
  toggleWatched: defineAction<
    { movieId: number; watched: boolean },
    { ok: boolean }
  >(async (_ctx, { movieId, watched }) => {
    if (watched) await markWatched(movieId);
    else await unmarkWatched(movieId);
    return { ok: true };
  }),
};
```

- [ ] **Step 4: Run, verify 3 passed**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-list.server.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movies-list.server.ts apps/app/src/pages/__tests__/movies-list.server.test.ts
git commit -m "feat(app): movies-list loader streams bucketed search results

When ?q is present, yields cumulative buckets (exact title, substring,
overview, genre) with artificial inter-bucket delays so streaming is
visible. q='crash' demos mid-stream error. Empty q yields a single
list-mode chunk and returns."
```

---

## Task R10: SearchInput + layout refactor

**Files:**
- Modify: `apps/app/src/pages/movies-layout.tsx`
- Test: `apps/app/src/pages/__tests__/movies-layout.test.tsx` (new)

Drops `MoviesFilterContext`; adds URL-driven `SearchInput`. Does NOT mount any activity feed.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/pages/__tests__/movies-layout.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import MoviesLayout from '../movies-layout.js';

afterEach(() => cleanup());

describe('MoviesLayout SearchInput', () => {
  it('renders a search input labeled "Search movies"', async () => {
    render(
      <LocationProvider>
        <MoviesLayout>
          <p>child</p>
        </MoviesLayout>
      </LocationProvider>
    );
    const input = await screen.findByLabelText(/search movies/i);
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.getByText('child')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-layout.test.tsx
```

- [ ] **Step 3: Replace `movies-layout.tsx`**

```tsx
import { createContext } from 'preact';
import type { FunctionComponent } from 'preact';
import {
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'preact/hooks';
import type { LayoutProps } from '@hono-preact/iso';
import { useLocation } from '@hono-preact/iso';

type WatchedBadge = {
  count: number | null;
  setCount: (
    value: number | null | ((prev: number | null) => number | null)
  ) => void;
};

const WatchedBadgeContext = createContext<WatchedBadge>({
  count: null,
  setCount: () => {},
});

export const useWatchedBadge = () => useContext(WatchedBadgeContext);

function useDebounce<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const SearchInput: FunctionComponent = () => {
  const location = useLocation();
  const currentQ = ((location.searchParams as Record<string, string>)?.q ?? '');
  const [draft, setDraft] = useState(currentQ);
  const debounced = useDebounce(draft, 250);

  useEffect(() => { setDraft(currentQ); }, [currentQ]);

  useEffect(() => {
    if (debounced === currentQ) return;
    const next = debounced
      ? `/movies?q=${encodeURIComponent(debounced)}`
      : '/movies';
    location.route(next, true);
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
};

export default function MoviesLayout({ children }: LayoutProps) {
  const [count, setCount] = useState<number | null>(null);
  const badge = useMemo(() => ({ count, setCount }), [count]);

  return (
    <WatchedBadgeContext.Provider value={badge}>
      <section class="p-1">
        <header class="flex items-center gap-2">
          <a href="/" class="bg-amber-200">home</a>
          <a href="/watched" class="bg-emerald-200">
            watched ({count ?? '…'})
          </a>
          <SearchInput />
        </header>
        <div class="mt-2">{children}</div>
      </section>
    </WatchedBadgeContext.Provider>
  );
}
```

- [ ] **Step 4: Run, verify it passes**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-layout.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movies-layout.tsx apps/app/src/pages/__tests__/movies-layout.test.tsx
git commit -m "feat(app): movies layout uses URL-driven SearchInput

Replaces the layout-local MoviesFilterContext with a SearchInput that
reads ?q from the URL and debounces writes (replace=true) back to the
URL via useLocation().route(). MoviesFilterContext and useMoviesFilter
are removed; consumers in movies-list.tsx are updated in the next task.
The layout activity feed (section B in the spec) is deferred to a
later PR; see project_streaming_loader_framework_gaps memory."
```

---

## Task R11: Movies-list page renders bucketed search results

**Files:**
- Modify: `apps/app/src/pages/movies-list.tsx`
- Test: `apps/app/src/pages/__tests__/movies-list.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/pages/__tests__/movies-list.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import MoviesList from '../movies-list.js';
import { loader } from '../movies-list.server.js';
import { loader as watchedLoader } from '../watched.server.js';
import MoviesLayout from '../movies-layout.js';

afterEach(() => {
  cleanup();
  loader.cache.invalidate();
  watchedLoader.cache.invalidate();
});

const oneMovie = {
  id: 1,
  title: 'Moana 2',
  overview: '',
  release_date: '',
  vote_average: 0,
  vote_count: 0,
  poster_path: '',
  backdrop_path: '',
  genre_ids: [],
  popularity: 0,
  adult: false,
  original_language: 'en',
  original_title: '',
  video: false,
};

describe('MoviesList branches on data.mode', () => {
  it('renders plain list when mode === "list"', async () => {
    vi.spyOn(loader, 'fn').mockImplementation(async function* () {
      yield {
        mode: 'list',
        movies: { page: 1, total_pages: 1, total_results: 1, results: [oneMovie] },
        watchedIds: [],
      };
    } as never);

    render(
      <LocationProvider>
        <MoviesLayout>
          <MoviesList path="/movies" pathParams={{}} searchParams={{}} />
        </MoviesLayout>
      </LocationProvider>
    );

    await screen.findByText('Moana 2');
  });

  it('renders bucket headings when mode === "buckets"', async () => {
    vi.spyOn(loader, 'fn').mockImplementation(async function* () {
      yield {
        mode: 'buckets',
        query: 'moana',
        buckets: {
          exact: [oneMovie],
          titleSubstring: [],
          overview: [],
          genre: [],
        },
        watchedIds: [],
      };
    } as never);

    render(
      <LocationProvider>
        <MoviesLayout>
          <MoviesList path="/movies" pathParams={{}} searchParams={{ q: 'moana' }} />
        </MoviesLayout>
      </LocationProvider>
    );

    await screen.findByText('Exact matches');
    expect(screen.getByText('Moana 2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-list.test.tsx
```

- [ ] **Step 3: Replace `movies-list.tsx`**

```tsx
import { definePage, useOptimisticAction } from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import type { MovieSummary } from '@/server/data/movies.js';
import { loader, serverActions, type SearchResults } from './movies-list.server.js';
import { loader as watchedLoader } from './watched.server.js';
import { useWatchedBadge } from './movies-layout.js';

type ToggleFn = (payload: { movieId: number; watched: boolean }) => void;

const Row: FunctionComponent<{
  m: MovieSummary;
  watched: Set<number>;
  onToggle: ToggleFn;
}> = ({ m, watched, onToggle }) => (
  <li class="border-2 m-1 p-1 flex items-center gap-2">
    <a href={`/movies/${m.id}`} class="flex-1">
      {m.title}{' '}
      {watched.has(m.id) && <span class="text-emerald-600">✓ watched</span>}
    </a>
    <button
      type="button"
      class="bg-blue-500 text-white px-2 py-1 text-sm"
      onClick={() => onToggle({ movieId: m.id, watched: !watched.has(m.id) })}
    >
      {watched.has(m.id) ? 'Unwatch' : 'Mark watched'}
    </button>
  </li>
);

const Bucket: FunctionComponent<{
  title: string;
  movies: MovieSummary[];
  watched: Set<number>;
  onToggle: ToggleFn;
}> = ({ title, movies, watched, onToggle }) => {
  if (movies.length === 0) return null;
  return (
    <section class="mt-3">
      <h2 class="font-semibold">{title}</h2>
      <ul>
        {movies.map((m) => (
          <Row key={m.id} m={m} watched={watched} onToggle={onToggle} />
        ))}
      </ul>
    </section>
  );
};

const MoviesList: FunctionComponent = () => {
  const data = loader.useData() as SearchResults;
  const error = loader.useError();
  const { setCount } = useWatchedBadge();

  const { mutate, value: optimisticWatchedIds } = useOptimisticAction(
    serverActions.toggleWatched,
    {
      base: data.watchedIds,
      apply: (current, payload) =>
        payload.watched
          ? [...current, payload.movieId]
          : current.filter((id) => id !== payload.movieId),
      invalidate: [loader, watchedLoader],
    }
  );

  useEffect(() => {
    setCount(optimisticWatchedIds.length);
  }, [optimisticWatchedIds.length, setCount]);

  const watched = new Set(optimisticWatchedIds);

  return (
    <>
      {error && (
        <p class="text-red-700 bg-red-100 p-2 my-2">
          Search failed: {error.message}
        </p>
      )}
      {data.mode === 'list' ? (
        <ul class="mt-2">
          {data.movies.results.map((m) => (
            <Row key={m.id} m={m} watched={watched} onToggle={mutate} />
          ))}
        </ul>
      ) : (
        <>
          <p class="text-sm text-gray-600 mt-2">Results for "{data.query}"</p>
          <Bucket title="Exact matches"   movies={data.buckets.exact}          watched={watched} onToggle={mutate} />
          <Bucket title="Title contains"  movies={data.buckets.titleSubstring} watched={watched} onToggle={mutate} />
          <Bucket title="Overview mentions" movies={data.buckets.overview}     watched={watched} onToggle={mutate} />
          <Bucket title="Genre"           movies={data.buckets.genre}          watched={watched} onToggle={mutate} />
        </>
      )}
    </>
  );
};
MoviesList.displayName = 'MoviesList';

export default definePage(MoviesList, { loader });
```

- [ ] **Step 4: Run, verify 2 passed**

```bash
pnpm vitest run apps/app/src/pages/__tests__/movies-list.test.tsx
```

- [ ] **Step 5: Run the full suite + build**

```bash
pnpm vitest run
pnpm -w build
```

Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/pages/movies-list.tsx apps/app/src/pages/__tests__/movies-list.test.tsx
git commit -m "feat(app): movies-list renders bucketed search results"
```

---

## Task R12: Delete `/live-stats`

**Files:**
- Delete: `apps/app/src/pages/live-stats.tsx`
- Delete: `apps/app/src/pages/live-stats.server.ts`
- Modify: `apps/app/src/routes.ts`

- [ ] **Step 1: Delete files and update routes**

```bash
git rm apps/app/src/pages/live-stats.tsx apps/app/src/pages/live-stats.server.ts
```

Edit `apps/app/src/routes.ts` to remove the `/live-stats` block.

- [ ] **Step 2: Verify**

```bash
pnpm vitest run
pnpm -w build
```

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/routes.ts
git commit -m "chore(app): delete /live-stats; movies surface is the canonical streaming demo"
```

---

## Task R13: Update streaming docs

**Files:**
- Modify: `apps/app/src/pages/docs/streaming.mdx`

- [ ] **Step 1: Update line 58 reference**

Replace the existing "See `/live-stats` for a running example…" text (around line 58) with:

```mdx
See `/movies/:id` for a running example: a single streaming loader yields
a cumulative shape with four sections (token-by-token AI summary, fast-
trickle cast, slow-trickle similar movies, slow-single box office) that
fill in at independent cadences. See `/movies?q=drama` for input-driven
SSR streaming: the server yields match buckets (exact title, substring,
overview, genre) progressively as it scans the catalog.
```

- [ ] **Step 2: Update line 157 curl example**

Replace `curl -N http://localhost:5173/live-stats` with:

```
curl -N 'http://localhost:5173/movies/1241982'
```

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/docs/streaming.mdx
git commit -m "docs: point streaming.mdx at /movies examples instead of /live-stats"
```

---

## Task R14: SSR integration smoke test

**Files:**
- Modify: `packages/server/src/__tests__/render-stream.test.tsx`

- [ ] **Step 1: Add the test**

Append to `packages/server/src/__tests__/render-stream.test.tsx`:

```tsx
import { definePage } from '@hono-preact/iso';
import { loader as moviesListLoader } from '../../../../apps/app/src/pages/movies-list.server.js';

describe('renderPage: movies-list streaming search SSR', () => {
  it('streams bucket chunks when q is present', async () => {
    const PageBody = () => {
      const data = moviesListLoader.useData() as { mode: string };
      return <p data-testid="mode">{data.mode}</p>;
    };
    const Page = definePage(PageBody, { loader: moviesListLoader });

    const app = new Hono();
    app.get('/movies', (c) =>
      renderPage(
        c,
        <Page path="/movies" pathParams={{}} searchParams={{ q: 'moana' }} />
      )
    );

    const res = await app.request('/movies?q=moana');
    const body = await readBody(res);
    expect(body).toContain('__HP_STREAM__');
    const pushCount = (body.match(/__HP_STREAM__\.push/g) ?? []).length;
    expect(pushCount).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run, verify it passes**

```bash
pnpm vitest run packages/server/src/__tests__/render-stream.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/render-stream.test.tsx
git commit -m "test(server): SSR integration smoke for streaming search buckets"
```

---

## Task R15: Manual smoke check

Run the dev server and verify behavior. Not automated.

- [ ] **Step 1: Start dev server**

```bash
pnpm -w dev
```

- [ ] **Step 2: Verify the movie detail page streams**

Visit `http://localhost:5173/movies/1241982`. Expected:
- Title, watched controls, notes, and photo render instantly.
- Summary section fills in word-by-word over ~2.5s.
- Cast section fills row-by-row over ~1s.
- Similar movies fills card-by-card over ~1.6s.
- Box office shows skeleton for ~2s, then a single chunk fills it.

- [ ] **Step 3: Verify the crash demo**

Visit `http://localhost:5173/movies/1241982?demo=crash`. Expected:
- Summary, Cast, Similar render normally.
- Box office section shows the red error banner.

- [ ] **Step 4: Verify streaming search**

Visit `http://localhost:5173/movies?q=drama`. Buckets should fill in over ~1.2s. Empty buckets hidden.

- [ ] **Step 5: Verify search input behavior**

Type "moana" letter by letter; URL updates to `/movies?q=moana` after ~250ms. Back button restores prior route (not intermediate queries).

- [ ] **Step 6: Verify the crash search demo**

Visit `http://localhost:5173/movies?q=crash`. Should briefly show empty buckets, then a red "Search failed" banner.

- [ ] **Step 7: Stop dev server (Ctrl-C)**

---

## Task R16: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/movies-streaming-demo
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(app): movies-integrated streaming demo" --body "$(cat <<'EOF'
## Summary
- Replaces the synthetic `/live-stats` ticker as the headline streaming demo.
- `/movies/:id` runs a unified streaming loader that drives four sections (cast, similar, AI-style summary, box office) at independent cadences in a single async generator.
- `/movies?q=…` streams bucketed search results (exact title, substring, overview, genre).
- Original spec section B (layout-anchored activity feed) is deferred until framework Gap 1 (public multi-loader-per-file API) lands.

## Framework gaps surfaced
- Mid-implementation we hit a hard build-time constraint: `server-only` plugin allows only `default, loader, serverGuards, serverActions, actionGuards` as named exports from `.server.*` files, and the loader RPC keys by module path with one default loader per file. Section A is implemented as a single unified loader rather than four parallel loaders to work within this constraint. See `project_streaming_loader_framework_gaps.md` (memory) and the spec's revision note.

## Test plan
- [x] `pnpm vitest run` passes all tests
- [x] `pnpm -w build` succeeds
- [x] Manual smoke check (see plan Task R15)

Spec: `docs/superpowers/specs/2026-05-12-movies-streaming-demo-design.md`
Plan: `docs/superpowers/plans/2026-05-12-movies-streaming-demo.md` (Revised tasks section)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Capture PR URL**
