# Home Scroll Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation runs in a dedicated `git worktree` + branch (per repo convention); the executing skill sets it up with `pnpm wt:setup`.

**Goal:** Replace the static `apps/site` home page with a scroll-driven, progressively-enhanced storytelling page: scroll is the scrubber, a browser preview reacts while the real connection plays as a network timeline, across 12 chapters that are each literally true of hono-preact.

**Architecture:** A tiny hand-rolled scroll kit (`ScrollStage`/`Actor` publish a normalized `0..1` playhead via context from `window.scrollY`; `LiveStage` publishes the same context shape from an rAF clock for the realtime chapter). Leaf primitives (`Wire`/`Lane`/`Playhead`/`BrowserFrame`/`Region`/`Reveal`) read that playhead and render. Each chapter is a declarative composition of primitives + config + real copy. SSR renders a representative static frame (so no-JS and pre-hydration are coherent); reduced motion and (opt-in) narrow viewports keep that static frame instead of pinning.

**Tech Stack:** Preact + `preact/hooks`, hono-preact (the site is itself a hono-preact app), Vite, Tailwind v4 utilities + custom CSS in `root.css`, vitest 4 + `@testing-library/preact` + happy-dom, Selawik font, existing `root.css` design tokens.

## Global Constraints

Every task's requirements implicitly include these (copied from the spec):

- **Scope:** `apps/site` home route only. No change to any `packages/` framework code. No new dependencies.
- **Truth only:** every chapter's copy states something true of the framework today. Use the per-chapter true claim + API snippet from the spec (`docs/superpowers/specs/2026-07-05-home-scroll-experience-design.md`, section 3). Do not stretch a claim; if it is not true, cut the chapter.
- **House style:** no em-dashes (`—`) in any prose, copy, or code comment. Use commas, colons, parentheses, or two sentences.
- **Tokens:** use existing `root.css` tokens (orangenta gradient, Selawik, `--accent`/`--muted`/`--surface`/`--border`, light/dark). Add exactly three new semantic wire tokens (`--wire-inflight`, `--wire-done`, `--wire-cancel`) for both themes; each must clear WCAG AA on the surface it sits on.
- **Mechanic:** the scrub is JS `window.scrollY` + `requestAnimationFrame`. Do NOT depend on CSS `animation-timeline` / scroll-driven animations for correctness (Newly Available only; JS baseline must work everywhere). `position: sticky`, CSS grid, `color-mix`, `svh`, `startViewTransition` are allowed as used.
- **Progressive enhancement:** SSR renders a representative static frame; the page is coherent with no JS and before hydration (headings, copy, code are real server-rendered text). First client render must equal the SSR render (start every stage at `fallbackProgress`, begin animating only in `useEffect`) so hydration never mismatches.
- **Reduced motion / responsive:** `prefers-reduced-motion: reduce` keeps the static frame and attaches no scroll/rAF listeners. Two-panel scenes stack below `~48rem`. Pinned stages are sized in `svh`. Interactive targets are `>=44px`. The page body never scrolls horizontally at any width (wide content gets its own `overflow-x: auto`).
- **CTAs preserved:** primary CTA links to `/docs/quick-start`; secondary CTA links to `/demo`. The hero keeps the existing `HeroShader`.
- **Bundle:** the home experience is dynamically imported for `/` only (it already is: `routes.ts:15`). Keep the kit small; below-fold chapters lazy-init via IntersectionObserver setup inside `useEffect`. Read the `client-size` PR comment after opening the PR.
- **CI parity before push (8 steps, from `CLAUDE.md`):** framework build, `pnpm gen:agents-corpus`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:types`, `pnpm test:coverage`, `pnpm test:integration`, `pnpm --filter site build`. `format:check` is the most-missed; fix with `pnpm format`.
- **Test command (single file, from repo root):** `pnpm vitest run <path>`.

## File Structure

```
apps/site/src/pages/home.tsx                              # MODIFY: compose chapters, meta/title, CTAs (currently the old page)
apps/site/src/pages/__tests__/home.test.tsx              # MODIFY: keep CTA/hero asserts, add chapter-mount + fallback asserts
apps/site/src/styles/root.css                             # MODIFY: @import home.css; add 3 wire tokens (light+dark)
apps/site/src/styles/home.css                             # CREATE: kit + chapter styles (hx- namespace)
apps/site/src/components/home/scroll/progress.ts          # CREATE: pure math (clamp01, computeProgress, sliceProgress, barState)
apps/site/src/components/home/scroll/motion.ts            # CREATE: usePrefersReducedMotion, useIsNarrow
apps/site/src/components/home/scroll/stage.tsx            # CREATE: StageContext, useStageProgress, ScrollStage, Actor, LiveStage
apps/site/src/components/home/scroll/primitives.tsx       # CREATE: Wire, Lane, Playhead, BrowserFrame, Region, Reveal
apps/site/src/components/home/scroll/__tests__/*.test.ts(x)
apps/site/src/components/home/chapters/ChapterHero.tsx    # CREATE (12 chapter files, one per file)
apps/site/src/components/home/chapters/ChapterEdge.tsx
apps/site/src/components/home/chapters/ChapterRouting.tsx
apps/site/src/components/home/chapters/ChapterSSR.tsx
apps/site/src/components/home/chapters/ChapterStreaming.tsx
apps/site/src/components/home/chapters/ChapterMutations.tsx
apps/site/src/components/home/chapters/ChapterResilience.tsx
apps/site/src/components/home/chapters/ChapterPrefetch.tsx
apps/site/src/components/home/chapters/ChapterTransitions.tsx
apps/site/src/components/home/chapters/ChapterRealtime.tsx
apps/site/src/components/home/chapters/ChapterOnePackage.tsx
apps/site/src/components/home/chapters/ChapterCTA.tsx
apps/site/src/components/home/chapters/__tests__/*.test.tsx
```

Each chapter file owns its copy, code snippet, and device config. The kit files own all animation/geometry logic so chapters stay declarative.

---

### Task 1: Scroll geometry (pure functions)

Pure, dependency-free math is the foundation every stage and primitive uses. Unit-test it directly (no DOM).

**Files:**
- Create: `apps/site/src/components/home/scroll/progress.ts`
- Test: `apps/site/src/components/home/scroll/__tests__/progress.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `clamp01(n: number): number`
  - `computeProgress(rectTop: number, stageHeight: number, viewportH: number): number` — normalized `0..1` playhead for a pinned stage, `= clamp01(-rectTop / max(stageHeight - viewportH, 1))`.
  - `sliceProgress(parent: number, start: number, end: number): number` — re-normalize `[start,end]` of a parent playhead to a local `0..1`.
  - `barState(progress: number, start: number, size: number, cancelAt?: number): { width: number; state: 'idle' | 'inflight' | 'done' | 'cancel' }` — a network bar's fill and status.

- [ ] **Step 1: Write the failing test**

```ts
// apps/site/src/components/home/scroll/__tests__/progress.test.ts
import { describe, it, expect } from 'vitest';
import { clamp01, computeProgress, sliceProgress, barState } from '../progress.js';

describe('clamp01', () => {
  it('clamps to the 0..1 range', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });
});

describe('computeProgress', () => {
  it('is 0 when the stage top is at the viewport top', () => {
    expect(computeProgress(0, 3000, 1000)).toBe(0);
  });
  it('is 1 when scrolled one viewport short of the stage bottom', () => {
    // stageHeight 3000, viewport 1000 -> scrub range 2000; rectTop -2000 -> 1
    expect(computeProgress(-2000, 3000, 1000)).toBe(1);
  });
  it('is 0.5 at the midpoint and never divides by zero', () => {
    expect(computeProgress(-1000, 3000, 1000)).toBe(0.5);
    expect(computeProgress(-10, 1000, 1000)).toBe(1); // range guarded to >= 1
  });
});

describe('sliceProgress', () => {
  it('re-normalizes a sub-window to local 0..1', () => {
    expect(sliceProgress(0.5, 0.25, 0.75)).toBe(0.5);
    expect(sliceProgress(0.2, 0.25, 0.75)).toBe(0);
    expect(sliceProgress(0.9, 0.25, 0.75)).toBe(1);
  });
});

describe('barState', () => {
  it('reports idle, in-flight, then done as the playhead crosses [start, start+size]', () => {
    expect(barState(0, 0.2, 0.4).state).toBe('idle');
    expect(barState(0.4, 0.2, 0.4)).toEqual({ width: 0.5, state: 'inflight' });
    expect(barState(0.7, 0.2, 0.4).state).toBe('done');
  });
  it('freezes width and flags cancel once past cancelAt', () => {
    const s = barState(0.9, 0.2, 0.4, 0.4);
    expect(s.state).toBe('cancel');
    expect(s.width).toBeCloseTo(0.5); // frozen at (0.4-0.2)/0.4
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/site/src/components/home/scroll/__tests__/progress.test.ts`
Expected: FAIL, cannot resolve `../progress.js`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// apps/site/src/components/home/scroll/progress.ts
export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// Normalized 0..1 playhead for a pinned stage. `rectTop` is the stage element's
// getBoundingClientRect().top (0 when the stage reaches the viewport top, then
// negative as the reader scrolls past); `stageHeight` is the spacer height and
// `viewportH` is the visible height, so the scrub range is one viewport shorter.
export function computeProgress(
  rectTop: number,
  stageHeight: number,
  viewportH: number
): number {
  const range = Math.max(stageHeight - viewportH, 1);
  return clamp01(-rectTop / range);
}

export function sliceProgress(parent: number, start: number, end: number): number {
  return clamp01((parent - start) / Math.max(end - start, 1e-6));
}

export type BarStatus = 'idle' | 'inflight' | 'done' | 'cancel';

export function barState(
  progress: number,
  start: number,
  size: number,
  cancelAt?: number
): { width: number; state: BarStatus } {
  if (cancelAt != null && progress >= cancelAt) {
    return { width: clamp01((cancelAt - start) / size), state: 'cancel' };
  }
  const width = clamp01((progress - start) / size);
  return { width, state: width <= 0 ? 'idle' : width >= 1 ? 'done' : 'inflight' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/site/src/components/home/scroll/__tests__/progress.test.ts`
Expected: PASS (4 describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/home/scroll/progress.ts apps/site/src/components/home/scroll/__tests__/progress.test.ts
git commit -m "feat(site): scroll-kit geometry (progress + bar state)"
```

---

### Task 2: Motion + responsive hooks

SSR-safe hooks that gate the whole kit. They must return a stable value on the server and first client render, then update after mount.

**Files:**
- Create: `apps/site/src/components/home/scroll/motion.ts`
- Test: `apps/site/src/components/home/scroll/__tests__/motion.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `usePrefersReducedMotion(): boolean` — `false` on server/first render; reflects `matchMedia('(prefers-reduced-motion: reduce)')` after mount.
  - `useIsNarrow(maxRem?: number): boolean` — `false` on server/first render; `true` after mount when `matchMedia('(max-width: <maxRem>rem)')` matches. Default `maxRem = 48`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/site/src/components/home/scroll/__tests__/motion.test.ts
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/preact';
import { usePrefersReducedMotion, useIsNarrow } from '../motion.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe('usePrefersReducedMotion', () => {
  it('reflects a reduce preference after mount', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });
  it('is false when no reduce preference', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});

describe('useIsNarrow', () => {
  it('is true when the narrow query matches', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useIsNarrow(48));
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/site/src/components/home/scroll/__tests__/motion.test.ts`
Expected: FAIL, cannot resolve `../motion.js`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// apps/site/src/components/home/scroll/motion.ts
import { useEffect, useState } from 'preact/hooks';

function useMediaQuery(query: string): boolean {
  // Start false so the server render and the first client render agree (no
  // hydration mismatch); update to the real value after mount.
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(query);
    const sync = () => setMatches(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export function useIsNarrow(maxRem = 48): boolean {
  return useMediaQuery(`(max-width: ${maxRem}rem)`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/site/src/components/home/scroll/__tests__/motion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/home/scroll/motion.ts apps/site/src/components/home/scroll/__tests__/motion.test.ts
git commit -m "feat(site): SSR-safe reduced-motion + narrow-viewport hooks"
```

---

### Task 3: Stage providers (ScrollStage, Actor, LiveStage)

The context providers that turn scroll (or an rAF clock) into a normalized playhead. This is the linchpin every chapter consumes.

**Files:**
- Create: `apps/site/src/components/home/scroll/stage.tsx`
- Test: `apps/site/src/components/home/scroll/__tests__/stage.test.tsx`

**Interfaces:**
- Consumes: `computeProgress`, `sliceProgress` (Task 1); `usePrefersReducedMotion`, `useIsNarrow` (Task 2).
- Produces:
  - `interface StageValue { progress: number; pinned: boolean }`
  - `useStageProgress(): StageValue` — reads the nearest stage/actor context (default `{ progress: 0, pinned: false }`).
  - `ScrollStage(props: { pages: number; pagesNarrow?: number; fallbackProgress?: number; unpinOnNarrow?: boolean; label?: string; children: ComponentChildren }): VNode` — renders a `pages * 100svh` spacer with a `svh`-tall sticky inner; provides progress from scroll. When reduced (or narrow + `unpinOnNarrow`) it renders static at `fallbackProgress` with no listeners.
  - `Actor(props: { start: number; end: number; children: ComponentChildren }): VNode` — slices the parent playhead to a local `0..1`.
  - `LiveStage(props: { periodMs?: number; fallbackProgress?: number; children: ComponentChildren }): VNode` — provides a looping `0..1` playhead from an rAF clock while in view; static at `fallbackProgress` when reduced.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/site/src/components/home/scroll/__tests__/stage.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { ScrollStage, Actor, useStageProgress } from '../stage.js';

afterEach(() => cleanup());

function Probe() {
  const { progress } = useStageProgress();
  return <span data-testid="p">{progress.toFixed(2)}</span>;
}

describe('ScrollStage', () => {
  it('provides the fallback frame on first render (SSR parity)', () => {
    render(
      <ScrollStage pages={3} fallbackProgress={0.5}>
        <Probe />
      </ScrollStage>
    );
    expect(screen.getByTestId('p').textContent).toBe('0.50');
  });
});

describe('Actor', () => {
  it('re-normalizes the parent playhead to a local 0..1', () => {
    render(
      <ScrollStage pages={2} fallbackProgress={0.5}>
        <Actor start={0.25} end={0.75}>
          <Probe />
        </Actor>
      </ScrollStage>
    );
    // parent 0.5 within [0.25, 0.75] -> local 0.5
    expect(screen.getByTestId('p').textContent).toBe('0.50');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/site/src/components/home/scroll/__tests__/stage.test.tsx`
Expected: FAIL, cannot resolve `../stage.js`.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// apps/site/src/components/home/scroll/stage.tsx
import { createContext } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { computeProgress, sliceProgress } from './progress.js';
import { usePrefersReducedMotion, useIsNarrow } from './motion.js';

export interface StageValue {
  progress: number;
  pinned: boolean;
}

const StageContext = createContext<StageValue>({ progress: 0, pinned: false });

export function useStageProgress(): StageValue {
  return useContext(StageContext);
}

export function ScrollStage({
  pages,
  pagesNarrow,
  fallbackProgress = 0.5,
  unpinOnNarrow = false,
  label,
  children,
}: {
  pages: number;
  pagesNarrow?: number;
  fallbackProgress?: number;
  unpinOnNarrow?: boolean;
  label?: string;
  children: ComponentChildren;
}): VNode {
  const reduced = usePrefersReducedMotion();
  const narrow = useIsNarrow();
  const unpinned = reduced || (unpinOnNarrow && narrow);
  const activePages = narrow && pagesNarrow ? pagesNarrow : pages;
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(fallbackProgress);

  useEffect(() => {
    if (unpinned) return;
    let raf = 0;
    const tick = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      setProgress(
        computeProgress(el.getBoundingClientRect().top, el.offsetHeight, window.innerHeight)
      );
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    tick();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [unpinned]);

  if (unpinned) {
    return (
      <div class="hx-stage hx-stage--static" ref={ref} aria-label={label}>
        <StageContext.Provider value={{ progress: fallbackProgress, pinned: false }}>
          {children}
        </StageContext.Provider>
      </div>
    );
  }
  return (
    <div
      class="hx-stage"
      ref={ref}
      style={{ height: `calc(${activePages} * 100svh)` }}
      aria-label={label}
    >
      <div class="hx-stage__pin">
        <StageContext.Provider value={{ progress, pinned: true }}>
          {children}
        </StageContext.Provider>
      </div>
    </div>
  );
}

export function Actor({
  start,
  end,
  children,
}: {
  start: number;
  end: number;
  children: ComponentChildren;
}): VNode {
  const parent = useStageProgress();
  return (
    <StageContext.Provider
      value={{ progress: sliceProgress(parent.progress, start, end), pinned: parent.pinned }}
    >
      {children}
    </StageContext.Provider>
  );
}

export function LiveStage({
  periodMs = 6000,
  fallbackProgress = 1,
  children,
}: {
  periodMs?: number;
  fallbackProgress?: number;
  children: ComponentChildren;
}): VNode {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(fallbackProgress);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let running = true;
    const loop = (ts: number) => {
      if (!running) return;
      const el = ref.current;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < window.innerHeight) {
          setProgress((ts % periodMs) / periodMs);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced, periodMs]);

  return (
    <div class="hx-live" ref={ref}>
      <StageContext.Provider value={{ progress, pinned: false }}>
        {children}
      </StageContext.Provider>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/site/src/components/home/scroll/__tests__/stage.test.tsx`
Expected: PASS (both stages render the fallback frame; Actor re-normalizes).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/home/scroll/stage.tsx apps/site/src/components/home/scroll/__tests__/stage.test.tsx
git commit -m "feat(site): ScrollStage/Actor/LiveStage playhead providers"
```

---

### Task 4: Wire + browser primitives

The leaf renderers every device composes. They read the stage playhead and render bars, a playhead cursor, a browser preview, threshold-gated regions, and IO-based reveals.

**Files:**
- Create: `apps/site/src/components/home/scroll/primitives.tsx`
- Test: `apps/site/src/components/home/scroll/__tests__/primitives.test.tsx`

**Interfaces:**
- Consumes: `useStageProgress` (Task 3); `barState` (Task 1); `usePrefersReducedMotion` (Task 2).
- Produces:
  - `Wire(props: { caption: string; children: ComponentChildren }): VNode` — a titled network panel with a `Playhead`.
  - `Lane(props: { label: string; start: number; size: number; tone?: 'accent' | 'grad'; cancelAt?: number }): VNode` — a labeled resource bar; width and `data-state` come from `barState(progress, ...)`.
  - `Playhead(): VNode` — a vertical line at `left: progress*100%`.
  - `BrowserFrame(props: { url: string; live?: boolean; children: ComponentChildren }): VNode` — chrome + URL bar (+ optional live dot).
  - `Region(props: { showAt: number; skeleton: ComponentChildren; children: ComponentChildren }): VNode` — renders `skeleton` until `progress >= showAt`, then `children` (both always in the DOM for SSR; visibility via `data-shown`).
  - `Reveal(props: { children: ComponentChildren; delayMs?: number }): VNode` — fade/rise in when scrolled into view (IntersectionObserver in `useEffect`; shown immediately when reduced or IO unavailable).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/site/src/components/home/scroll/__tests__/primitives.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { ScrollStage } from '../stage.js';
import { Lane, BrowserFrame, Region } from '../primitives.js';

afterEach(() => cleanup());

describe('Lane', () => {
  it('renders a labeled bar whose state reflects the fallback playhead', () => {
    render(
      <ScrollStage pages={2} fallbackProgress={1}>
        <Lane label="POST /__loaders" start={0} size={0.5} />
      </ScrollStage>
    );
    const fill = document.querySelector('.hx-lane__fill') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.getAttribute('data-state')).toBe('done'); // progress 1, fully filled
    expect(screen.getByText('POST /__loaders')).toBeInTheDocument();
  });
});

describe('BrowserFrame', () => {
  it('renders chrome with the given url', () => {
    render(<BrowserFrame url="example.app / projects"><p>body</p></BrowserFrame>);
    expect(screen.getByText('example.app / projects')).toBeInTheDocument();
  });
});

describe('Region', () => {
  it('keeps both skeleton and content in the DOM for SSR', () => {
    render(
      <ScrollStage pages={2} fallbackProgress={1}>
        <Region showAt={0.5} skeleton={<span>loading</span>}>
          <span>Invoice #102000</span>
        </Region>
      </ScrollStage>
    );
    expect(screen.getByText('Invoice #102000')).toBeInTheDocument();
    // shown at fallback 1 (>= 0.5)
    expect(document.querySelector('.hx-region')?.getAttribute('data-shown')).toBe('true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/site/src/components/home/scroll/__tests__/primitives.test.tsx`
Expected: FAIL, cannot resolve `../primitives.js`.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// apps/site/src/components/home/scroll/primitives.tsx
import type { ComponentChildren, VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStageProgress } from './stage.js';
import { barState } from './progress.js';
import { usePrefersReducedMotion } from './motion.js';

export function Playhead(): VNode {
  const { progress } = useStageProgress();
  return (
    <div class="hx-playhead" aria-hidden="true" style={{ left: `${progress * 100}%` }} />
  );
}

export function Wire({ caption, children }: { caption: string; children: ComponentChildren }): VNode {
  return (
    <div class="hx-wire">
      <div class="hx-wire__cap">{caption}</div>
      {children}
      <Playhead />
    </div>
  );
}

export function Lane({
  label,
  start,
  size,
  tone = 'accent',
  cancelAt,
}: {
  label: string;
  start: number;
  size: number;
  tone?: 'accent' | 'grad';
  cancelAt?: number;
}): VNode {
  const { progress } = useStageProgress();
  const { width, state } = barState(progress, start, size, cancelAt);
  return (
    <div class="hx-lane">
      <span class="hx-lane__label">{label}</span>
      <span class="hx-lane__track">
        <span
          class={`hx-lane__fill hx-lane__fill--${tone}`}
          data-state={state}
          style={{ width: `${width * 100}%` }}
        />
      </span>
    </div>
  );
}

export function BrowserFrame({
  url,
  live,
  children,
}: {
  url: string;
  live?: boolean;
  children: ComponentChildren;
}): VNode {
  return (
    <div class="hx-browser">
      <div class="hx-browser__bar">
        <i /><i /><i />
        <span class="hx-browser__url">{url}</span>
        {live ? (
          <span class="hx-live-tag">
            <b />
            live
          </span>
        ) : null}
      </div>
      <div class="hx-browser__body">{children}</div>
    </div>
  );
}

export function Region({
  showAt,
  skeleton,
  children,
}: {
  showAt: number;
  skeleton: ComponentChildren;
  children: ComponentChildren;
}): VNode {
  const { progress } = useStageProgress();
  const shown = progress >= showAt;
  return (
    <div class="hx-region" data-shown={String(shown)}>
      <div class="hx-region__skeleton" aria-hidden={shown ? 'true' : undefined}>
        {skeleton}
      </div>
      <div class="hx-region__content">{children}</div>
    </div>
  );
}

export function Reveal({
  children,
  delayMs = 0,
}: {
  children: ComponentChildren;
  delayMs?: number;
}): VNode {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  return (
    <div
      class="hx-reveal"
      ref={ref}
      data-shown={String(shown)}
      style={{ transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/site/src/components/home/scroll/__tests__/primitives.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/home/scroll/primitives.tsx apps/site/src/components/home/scroll/__tests__/primitives.test.tsx
git commit -m "feat(site): wire/browser/region/reveal scroll primitives"
```

---

### Task 5: Styles (tokens + kit CSS)

Add the three semantic wire tokens and the kit + shared chapter CSS. Chapters add only small chapter-specific rules later; this task establishes the shared visual language.

**Files:**
- Modify: `apps/site/src/styles/root.css` (add `@import './home.css';` after the Tailwind import; add 3 wire tokens to the light `:root`, the `prefers-color-scheme: dark` block, and the `:root[data-theme='dark']` block)
- Create: `apps/site/src/styles/home.css`

**Interfaces:**
- Consumes: existing tokens (`--accent`, `--muted`, `--surface`, `--surface-2`/`--surface-subtle`, `--border`, `--grad`/`--gradient-orangenta`, `--code-surface`).
- Produces: the `hx-` class vocabulary used by primitives and chapters (`.hx-stage`, `.hx-stage__pin`, `.hx-live`, `.hx-wire`, `.hx-lane*`, `.hx-playhead`, `.hx-browser*`, `.hx-region*`, `.hx-reveal`, `.hx-chapter`, `.hx-panels`, `.hx-scene__*`), plus tokens `--wire-inflight`, `--wire-done`, `--wire-cancel`.

- [ ] **Step 1: Add the wire tokens to `root.css`**

Add, in the light `:root` block (near the other status colors), values that clear WCAG AA on `--surface`/`--code-surface`:

```css
  --wire-inflight: var(--accent);
  --wire-done: #12855b; /* green, >= 4.5:1 on the code surface (light) */
  --wire-cancel: #c2410c; /* amber, >= 4.5:1 on the code surface (light) */
```

Add to BOTH dark blocks (`@media (prefers-color-scheme: dark) :root:not([data-theme])` and `:root[data-theme='dark']`):

```css
  --wire-inflight: var(--accent);
  --wire-done: #37c98b; /* green, >= 4.5:1 on the dark code surface */
  --wire-cancel: #fb923c; /* amber, >= 4.5:1 on the dark code surface */
```

Add the import right after `@import 'tailwindcss';` at the top of `root.css`:

```css
@import './home.css';
```

- [ ] **Step 2: Create `home.css`**

```css
/* Home scroll experience. All classes are `hx-` namespaced. Uses root.css tokens. */
.hx-chapter { position: relative; }
.hx-wrap { width: min(64rem, 100% - 3rem); margin-inline: auto; }
.hx-scene { position: relative; z-index: 2; width: min(64rem, 100% - 3rem); margin-inline: auto; }
.hx-scene__head { text-align: center; margin-bottom: 1.4rem; }
.hx-scene__step { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); }
.hx-scene__title { font-size: clamp(1.4rem, 3vw, 2.1rem); font-weight: 700; letter-spacing: -0.015em; margin-top: 0.4rem; text-wrap: balance; }
.hx-scene__desc { color: var(--muted); max-width: 38rem; margin: 0.5rem auto 0; }

.hx-stage { position: relative; }
.hx-stage__pin { position: sticky; top: 0; height: 100svh; display: flex; align-items: center; overflow: hidden; }
.hx-stage--static { padding: 3rem 0; }
.hx-live { position: relative; }

.hx-panels { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 1rem; align-items: stretch; }
@media (max-width: 48rem) { .hx-panels { grid-template-columns: 1fr; } .hx-cols2 { grid-template-columns: 1fr !important; } }
.hx-cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }

.hx-browser { border: 1px solid var(--border-color); border-radius: 0.8rem; overflow: hidden; background: var(--surface); box-shadow: var(--shadow-card); display: flex; flex-direction: column; }
.hx-browser__bar { display: flex; align-items: center; gap: 0.35rem; padding: 0.5rem 0.7rem; border-bottom: 1px solid var(--border-color); background: var(--surface-subtle); }
.hx-browser__bar i { width: 0.5rem; height: 0.5rem; border-radius: 999px; background: var(--border-color); }
.hx-browser__url { margin-left: 0.5rem; font-family: ui-monospace, monospace; font-size: 0.72rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hx-browser__body { position: relative; min-height: 11rem; padding: 0.9rem; display: flex; flex-direction: column; gap: 0.55rem; }
.hx-live-tag { margin-left: auto; display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.66rem; font-weight: 600; color: var(--wire-done); }
.hx-live-tag b { width: 0.45rem; height: 0.45rem; border-radius: 999px; background: var(--wire-done); animation: hx-pulse 1.4s ease-in-out infinite; }
@keyframes hx-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

.hx-wire { border: 1px solid var(--border-color); border-radius: 0.8rem; background: var(--code-surface); box-shadow: var(--shadow-card); padding: 0.8rem 0.9rem; display: flex; flex-direction: column; gap: 0.5rem; position: relative; overflow: hidden; }
.hx-wire__cap { font-family: ui-monospace, monospace; font-size: 0.64rem; letter-spacing: 0.05em; color: var(--muted); text-transform: uppercase; }
.hx-lane { display: grid; grid-template-columns: 7.5rem 1fr; align-items: center; gap: 0.5rem; }
.hx-lane__label { font-family: ui-monospace, monospace; font-size: 0.66rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hx-lane__track { position: relative; height: 0.9rem; border-radius: 0.28rem; background: var(--surface-subtle); overflow: hidden; }
.hx-lane__fill { position: absolute; inset: 0 auto 0 0; background: var(--wire-inflight); border-radius: 0.28rem; transition: background 0.2s; }
.hx-lane__fill--grad[data-state='inflight'], .hx-lane__fill--grad[data-state='done'] { background-image: var(--gradient-orangenta); }
.hx-lane__fill[data-state='done'] { background: var(--wire-done); }
.hx-lane__fill[data-state='cancel'] { background: var(--wire-cancel); }
.hx-playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: color-mix(in srgb, var(--accent) 70%, transparent); opacity: 0.5; pointer-events: none; }

.hx-region { position: relative; border: 1px solid var(--border-color); border-radius: 0.5rem; padding: 0.55rem 0.65rem; min-height: 2.6rem; }
.hx-region__skeleton { display: flex; flex-direction: column; gap: 0.3rem; transition: opacity 0.25s; }
.hx-region[data-shown='true'] .hx-region__skeleton { opacity: 0; }
.hx-region__content { position: absolute; inset: 0.55rem 0.65rem; opacity: 0; transform: translateY(4px); transition: opacity 0.3s, transform 0.3s; font-size: 0.82rem; }
.hx-region[data-shown='true'] .hx-region__content { opacity: 1; transform: none; }

.hx-reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
.hx-reveal[data-shown='true'] { opacity: 1; transform: none; }

/* Shared code-sample style (used by every chapter's <pre class="hx-code">). */
.hx-code { margin: 0; padding: 0.9rem 1.1rem; border: 1px solid var(--border-color); border-radius: 0.7rem; background: var(--code-surface); overflow-x: auto; font-family: ui-monospace, monospace; font-size: 0.8rem; line-height: 1.6; color: var(--foreground); }

@media (prefers-reduced-motion: reduce) {
  .hx-stage { height: auto !important; }
  .hx-stage__pin { position: static; height: auto; padding: 2.5rem 0; }
  .hx-playhead, .hx-live-tag b { display: none; }
  .hx-reveal { opacity: 1; transform: none; transition: none; }
  .hx-region__skeleton { display: none; }
  .hx-region__content { position: static; opacity: 1; transform: none; }
}
```

- [ ] **Step 3: Verify the site still builds and formats**

Run: `pnpm --filter site build`
Expected: build succeeds (CSS imports resolve).
Run: `pnpm format`
Expected: files formatted; no diff on re-run of `pnpm format:check`.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/styles/root.css apps/site/src/styles/home.css
git commit -m "feat(site): home scroll-experience tokens and kit styles"
```

---

### Task 6: Home shell + test scaffold

Rewrite `home.tsx` as the composition root. In this task it renders the hero + a placeholder for each chapter (imported as they are built in later tasks), the title/meta, and the two CTAs. Update the existing test to the new structure while keeping the CTA and hero guarantees.

**Files:**
- Modify: `apps/site/src/pages/home.tsx`
- Modify: `apps/site/src/pages/__tests__/home.test.tsx`

**Interfaces:**
- Consumes: `HeroShader` (`../components/HeroShader.js`, existing); chapter components (Tasks 7-18, imported as each lands).
- Produces: the `<Home>` default export; a `hx-home` root; the CTA links; a slot order the chapters fill.

- [ ] **Step 1: Update the test (keep guarantees, describe the new shell)**

```tsx
// apps/site/src/pages/__tests__/home.test.tsx
// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import Home from '../home.js';

afterEach(() => cleanup());

describe('home (scroll experience)', () => {
  it('links to /docs/quick-start as the primary CTA', () => {
    render(<Home />);
    expect(screen.getByRole('link', { name: /get started/i }).getAttribute('href')).toBe(
      '/docs/quick-start'
    );
  });
  it('links to /demo as the secondary CTA', () => {
    render(<Home />);
    expect(screen.getByRole('link', { name: /see the demo/i }).getAttribute('href')).toBe('/demo');
  });
  it('mounts the hero shader background', () => {
    const { container } = render(<Home />);
    const bg = container.querySelector('[aria-hidden="true"]');
    expect(bg?.querySelector('canvas')).not.toBeNull();
  });
  it('renders the hero headline', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/site/src/pages/__tests__/home.test.tsx`
Expected: FAIL (old copy assertions and/or new headline expectations mismatch the current page).

- [ ] **Step 3: Rewrite `home.tsx` as the shell (hero + CTAs; chapters wired in later tasks)**

```tsx
// apps/site/src/pages/home.tsx
import type { FunctionComponent } from 'preact';
import { useMeta, useTitle } from 'hoofd/preact';
import { HeroShader } from '../components/HeroShader.js';

const Home: FunctionComponent = () => {
  useTitle('hono-preact');
  useMeta({
    name: 'description',
    content:
      'Watch the connection come alive: hono-preact fetches, streams, mutates, transitions, and goes live, edge to browser.',
  });
  return (
    <div class="hx-home relative isolate overflow-hidden">
      <HeroShader />
      <main class="relative">
        {/* Hero */}
        <header class="hx-hero">
          <div class="hx-wrap">
            <span class="energy-bar w-16" aria-hidden="true" />
            <p class="hx-eyebrow">hono-preact v{__HONO_PREACT_VERSION__}</p>
            <h1 class="hx-hero__title">
              One framework, <span class="text-orangenta">edge to browser</span>.
            </h1>
            <p class="hx-hero__lede">
              Scroll down and watch a request assemble itself into a live page: routing,
              streaming, mutations, transitions, and realtime, all typed.
            </p>
            <div class="hx-hero__cta">
              <a class="hx-btn hx-btn--primary" href="/docs/quick-start">
                Get started
              </a>
              <a class="hx-btn hx-btn--ghost" href="/demo">
                See the demo
              </a>
            </div>
          </div>
        </header>

        {/* Chapters are added by later tasks, in order:
            <ChapterEdge /> <ChapterRouting /> <ChapterSSR /> <ChapterStreaming />
            <ChapterMutations /> <ChapterResilience /> <ChapterPrefetch />
            <ChapterTransitions /> <ChapterRealtime /> <ChapterOnePackage /> <ChapterCTA /> */}
      </main>
    </div>
  );
};
Home.displayName = 'Home';

export default Home;
```

Add the hero styles to `home.css` (append):

```css
.hx-hero { min-height: 92svh; display: flex; flex-direction: column; justify-content: center; padding: 5rem 0 3rem; }
.hx-eyebrow { margin-top: 1.1rem; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
.hx-hero__title { font-size: clamp(2.4rem, 6vw, 4.1rem); font-weight: 700; line-height: 1.03; letter-spacing: -0.02em; margin-top: 1rem; text-wrap: balance; }
.hx-hero__lede { font-size: clamp(1.05rem, 2.2vw, 1.3rem); color: var(--muted); max-width: 36rem; margin: 1.25rem 0 0; }
.hx-hero__cta { display: flex; gap: 0.75rem; padding-top: 1.5rem; flex-wrap: wrap; }
.hx-btn { text-decoration: none; font-weight: 600; padding: 0.6rem 1.1rem; border-radius: 0.6rem; min-height: 44px; display: inline-flex; align-items: center; }
.hx-btn--primary { background: var(--accent); color: var(--accent-foreground); }
.hx-btn--primary:hover { background: var(--accent-hover); }
.hx-btn--ghost { border: 1px solid var(--border-color); color: var(--foreground); background: color-mix(in srgb, var(--surface) 80%, transparent); }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/site/src/pages/__tests__/home.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/home.tsx apps/site/src/pages/__tests__/home.test.tsx apps/site/src/styles/home.css
git commit -m "feat(site): home shell (hero + CTAs) for the scroll experience"
```

---

### Task 7: Runs on the platform (edge)

**Files:**
- Create: apps/site/src/components/home/chapters/ChapterEdge.tsx
- Test: apps/site/src/components/home/chapters/__tests__/ChapterEdge.test.tsx
- Modify: apps/site/src/styles/home.css  (appends a small `.hx-edge-*` block, tokens only)

**Interfaces:**
- Consumes: `Reveal` from '../scroll/primitives.js' (calm chapter: no `ScrollStage`, `Actor`, `LiveStage`, `Wire`, `Lane`, or `BrowserFrame`).
- Produces: `export function ChapterEdge(): VNode`

- [ ] **Step 1: Write the failing test**
```tsx
// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { ChapterEdge } from '../ChapterEdge.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterEdge (runs on the platform)', () => {
  it('renders the heading, the pitch, and the adapter code sample', () => {
    const { container } = render(<ChapterEdge />);

    // Chapter heading is an h2.
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /runs on the platform, at the edge/i,
      })
    ).toBeInTheDocument();

    // A >=6-word substring of the desc that spans both clauses, so it is
    // unique to the full desc paragraph (no single card repeats it).
    expect(
      screen.getByText(/Node; you pick the runtime with a one-line adapter/i)
    ).toBeInTheDocument();

    // One of the three Reveal cards.
    expect(
      screen.getByRole('heading', { level: 3, name: /one-line adapter swap/i })
    ).toBeInTheDocument();

    // The real snippet renders in a <pre> code sample.
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('cloudflareAdapter()');
    expect(pre!.textContent).toContain('nodeAdapter()');
  });

  it('still renders the heading, pitch, and Reveal cards with reduced motion', () => {
    // Stub prefers-reduced-motion: reduce so Reveal keeps a static frame.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

    render(<ChapterEdge />);

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /runs on the platform, at the edge/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Node; you pick the runtime with a one-line adapter/i)
    ).toBeInTheDocument();
    // Reveal-wrapped content is present too: proves the static frame renders
    // its children under reduced motion, not just the head outside Reveal.
    expect(
      screen.getByRole('heading', { level: 3, name: /one-line adapter swap/i })
    ).toBeInTheDocument();
  });
});
```
- [ ] **Step 2: Run the test to verify it fails**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterEdge.test.tsx
Expected: FAIL (cannot resolve '../ChapterEdge.js').
- [ ] **Step 3: Write the component**
```tsx
import type { VNode } from 'preact';
import { Reveal } from '../scroll/primitives.js';

const EYEBROW = 'The platform';
const TITLE = 'Runs on the platform, at the edge.';
const DESC =
  'hono-preact is a Web Fetch app on Hono. The same source SSRs and serves realtime on Cloudflare Workers or Node; you pick the runtime with a one-line adapter.';
const SNIPPET = `// vite.config.ts
honoPreact({ adapter: cloudflareAdapter() }); // or nodeAdapter()`;

export function ChapterEdge(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene__head">
        <p class="hx-edge-eyebrow">{EYEBROW}</p>
        <h2 class="hx-scene__title">{TITLE}</h2>
        <p class="hx-scene__desc">{DESC}</p>
      </div>

      <div class="hx-edge-cards">
        <Reveal>
          <article class="hx-edge-card">
            <h3 class="hx-edge-card__title">Edge</h3>
            <p class="hx-edge-card__line">
              The same source SSRs and serves realtime on Cloudflare Workers or
              Node.
            </p>
          </article>
        </Reveal>

        <Reveal delayMs={80}>
          <article class="hx-edge-card">
            <h3 class="hx-edge-card__title">Web standards</h3>
            <p class="hx-edge-card__line">
              hono-preact is a Web Fetch app on Hono.
            </p>
          </article>
        </Reveal>

        <Reveal delayMs={160}>
          <article class="hx-edge-card">
            <h3 class="hx-edge-card__title">One-line adapter swap</h3>
            <p class="hx-edge-card__line">
              You pick the runtime with a one-line adapter.
            </p>
            <pre class="hx-edge-card__code">
              <code>{SNIPPET}</code>
            </pre>
          </article>
        </Reveal>
      </div>
    </section>
  );
}
```
Append to apps/site/src/styles/home.css (tokens only; the `<pre>` scrolls inside its own box, and the grid collapses to one column under 48rem so the body never scrolls horizontally; no interactive elements, so no tap-target rule applies):
```css
/* Chapter: runs on the platform (edge). Calm three-card row. */
.hx-edge-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.72rem;
  color: var(--muted);
}
.hx-edge-cards {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
@media (max-width: 48rem) {
  .hx-edge-cards {
    grid-template-columns: 1fr;
  }
}
.hx-edge-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  background: var(--surface);
  box-shadow: var(--shadow-card);
}
.hx-edge-card__title {
  font-weight: 600;
  color: var(--foreground);
}
.hx-edge-card__line {
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.5;
}
.hx-edge-card__code {
  margin-top: auto;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: var(--code-surface);
  border: 1px solid var(--border-color);
  overflow-x: auto;
  font-size: 0.8rem;
}
```
- [ ] **Step 4: Run the test to verify it passes**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterEdge.test.tsx
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add apps/site/src/components/home/chapters/ChapterEdge.tsx apps/site/src/components/home/chapters/__tests__/ChapterEdge.test.tsx apps/site/src/styles/home.css
git commit -m "feat(site): edge chapter"
```

---

### Task 8: Routing is a manifest

**Files:**
- Create: apps/site/src/components/home/chapters/ChapterRouting.tsx
- Test: apps/site/src/components/home/chapters/__tests__/ChapterRouting.test.tsx
- Modify: apps/site/src/styles/home.css  <- small tokens-only block for the route stack, active ring, and >=44px pills

**Interfaces:**
- Consumes: `ScrollStage` and `useStageProgress` from `../scroll/stage.js`; `BrowserFrame` from `../scroll/primitives.js`. Inner `RouteStack` child calls `useStageProgress()` to derive the scrub index; a `useState` override index drives click/focus selection.
- Produces: `export function ChapterRouting(): VNode`

- [ ] **Step 1: Write the failing test**
```tsx
// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { ChapterRouting } from '../ChapterRouting.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterRouting (Routing is a manifest)', () => {
  it('renders the heading, the claim copy, the browser device, and the route pills', () => {
    const { container } = render(<ChapterRouting />);

    // Heading.
    expect(
      screen.getByRole('heading', { level: 2, name: /routing is a manifest/i })
    ).toBeInTheDocument();

    // A >=6-word substring of the true-claim desc copy.
    expect(
      screen.getByText(/nested layouts stay mounted while their child swaps/i)
    ).toBeInTheDocument();

    // Device: BrowserFrame renders the .hx-browser shell.
    expect(container.querySelector('.hx-browser')).not.toBeNull();

    // Four route-node pills prove the segment <-> component mapping.
    expect(screen.getByRole('button', { name: 'Root' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Section' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detail' })).toBeInTheDocument();

    // The real code snippet renders in a <pre>.
    expect(container.querySelector('pre')?.textContent).toMatch(
      /defineRoutes\(\[/
    );
  });

  it('still renders the heading and claim copy with reduced motion (static fallback frame)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

    render(<ChapterRouting />);

    expect(
      screen.getByRole('heading', { level: 2, name: /routing is a manifest/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nested layouts stay mounted while their child swaps/i)
    ).toBeInTheDocument();
  });
});
```
- [ ] **Step 2: Run the test to verify it fails**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterRouting.test.tsx
Expected: FAIL (cannot resolve `../ChapterRouting.js`).
- [ ] **Step 3: Write the component**
```tsx
import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { ScrollStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame } from '../scroll/primitives.js';

const NODES = ['Root', 'Section', 'List', 'Detail'] as const;

const SNIPPET = `defineRoutes([
  { path: '/projects', layout, children: [
    { path: ':id', view },
  ] },
]);`;

// Inner child: reads the pinned playhead and maps it to an active route node.
// Outer boxes (Root, Section, List) stay mounted while the inner box swaps,
// which is exactly what a nested-layout manifest does at runtime.
function RouteStack(): VNode {
  const { progress } = useStageProgress();
  const scrubIndex = Math.min(3, Math.floor(progress * 4));
  const [override, setOverride] = useState<number | null>(null);
  const active = override ?? scrubIndex;

  return (
    <div class="hx-cols2 hx-route">
      <BrowserFrame url="example.app / projects / 102000">
        <div class="hx-route__stack">
          {NODES.map((label, i) => (
            <div
              key={label}
              class="hx-route__box"
              data-active={i === active ? '' : undefined}
            >
              {label}
            </div>
          ))}
        </div>
      </BrowserFrame>
      <div class="hx-route__pills" role="group" aria-label="Route nodes">
        {NODES.map((label, i) => (
          <button
            key={label}
            type="button"
            class="hx-route__pill"
            data-active={i === active ? '' : undefined}
            onClick={() => setOverride(i)}
            onFocus={() => setOverride(i)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChapterRouting(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene">
        <div class="hx-scene__head">
          <p class="hx-scene__step">Routing</p>
          <h2 class="hx-scene__title">Routing is a manifest.</h2>
          <p class="hx-scene__desc">
            Your routes are a data structure, not a folder tree. Nested layouts
            stay mounted while their child swaps, and every node owns its own
            data and code-split.
          </p>
          <pre class="hx-route__code">
            <code>{SNIPPET}</code>
          </pre>
        </div>
        <div class="hx-panels">
          <ScrollStage
            pages={3}
            pagesNarrow={2}
            unpinOnNarrow
            label="Routing is a manifest"
          >
            <RouteStack />
          </ScrollStage>
        </div>
      </div>
    </section>
  );
}
```
Then append to `apps/site/src/styles/home.css` (tokens only; 44px is the hard tap-target minimum). Note: the raw border token in `root.css` is `--border-color`, not `--border`.
```css
/* Chapter: Routing is a manifest */
.hx-route__code {
  overflow-x: auto;
  max-inline-size: 100%;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: var(--code-surface);
  color: var(--foreground);
}
.hx-route__stack {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.hx-route__box {
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--code-surface);
  color: var(--muted);
  font-family: var(--font-sans);
}
.hx-route__box[data-active] {
  color: var(--foreground);
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.hx-route__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.hx-route__pill {
  min-block-size: 44px;
  min-inline-size: 44px;
  padding: 0 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--background);
  color: var(--foreground);
  cursor: pointer;
}
.hx-route__pill[data-active] {
  border-color: var(--accent);
  color: var(--accent);
}
```
- [ ] **Step 4: Run the test to verify it passes**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterRouting.test.tsx
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add apps/site/src/components/home/chapters/ChapterRouting.tsx apps/site/src/components/home/chapters/__tests__/ChapterRouting.test.tsx apps/site/src/styles/home.css
git commit -m "feat(site): routing-is-a-manifest chapter"
```

---

### Task 9: SSR, no client waterfall

**Files:**
- Create: apps/site/src/components/home/chapters/ChapterSSR.tsx
- Test: apps/site/src/components/home/chapters/__tests__/ChapterSSR.test.tsx
- Modify: apps/site/src/styles/home.css  (append a small chapter block: `.hx-panel`, `.hx-panel__cap`, `.hx-sk-line`, `.hx-code`)

**Interfaces:**
- Consumes: `ScrollStage` (from `../scroll/stage.js`); `BrowserFrame`, `Wire`, `Lane`, `Region` (from `../scroll/primitives.js`).
- Produces: `export function ChapterSSR(): VNode`
- Note: this chapter needs no custom playhead visuals; `Region`, `Wire`, and `Lane` read the stage playhead internally, so the component does not call `useStageProgress()` itself.

- [ ] **Step 1: Write the failing test**
```tsx
// apps/site/src/components/home/chapters/__tests__/ChapterSSR.test.tsx
// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { ChapterSSR } from '../ChapterSSR.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChapterSSR', () => {
  it('renders the heading, the true-claim copy, and the A/B devices', () => {
    render(<ChapterSSR />);

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('SSR, no client waterfall.');

    // A >= 6-word contiguous substring of the true desc copy.
    expect(
      screen.getByText(/The client never staircases through per-component fetches/)
    ).toBeInTheDocument();

    // Device chapter: an A/B of two comparison panels, each with a browser
    // preview and a network Wire. `.hx-panel` is this chapter's own wrapper
    // class (added to home.css, guaranteed to render); the address URL and a
    // lane label are strings fed into the kit primitives, so these checks are
    // kit-namespace-agnostic and independent of scroll progress.
    expect(document.querySelectorAll('.hx-panel')).toHaveLength(2);
    expect(screen.getAllByText(/example\.app \/ projects/)).toHaveLength(2);
    expect(screen.getByText(/hydrate\.js/)).toBeInTheDocument();
  });

  it('keeps the static frame (heading + copy) under prefers-reduced-motion', () => {
    // reduce=true makes ScrollStage render its static fallback frame with no
    // scroll listeners; the scene head text must still be server-coherent.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));

    render(<ChapterSSR />);

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('SSR, no client waterfall.');
    expect(
      screen.getByText(/The client never staircases through per-component fetches/)
    ).toBeInTheDocument();
  });
});
```
- [ ] **Step 2: Run the test to verify it fails**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterSSR.test.tsx
Expected: FAIL (cannot resolve `../ChapterSSR.js`).
- [ ] **Step 3: Write the component**
```tsx
// apps/site/src/components/home/chapters/ChapterSSR.tsx
import type { VNode } from 'preact';
import { ScrollStage } from '../scroll/stage.js';
import { BrowserFrame, Wire, Lane, Region } from '../scroll/primitives.js';

// Exact framework API snippet. Rendered verbatim inside <pre>; the JSX-looking
// text is a string (no `${` sequences), so a template literal is safe.
const snippet = `export const serverLoaders = {
  default: defineLoader(async ({ signal }) => getProjects({ signal })),
};
const View = serverLoaders.default.View(({ data }) =>
  data ? <List items={data} /> : <Spinner />
);`;

export function ChapterSSR(): VNode {
  return (
    <section class="hx-chapter">
      <ScrollStage
        pages={3.4}
        pagesNarrow={2.4}
        unpinOnNarrow
        fallbackProgress={0.45}
        label="SSR, no client waterfall"
      >
        <div class="hx-scene">
          <div class="hx-scene__head">
            <p class="hx-scene__step">RPC 01 / SSR</p>
            <h2 class="hx-scene__title">SSR, no client waterfall.</h2>
            <p class="hx-scene__desc">
              Loaders run in parallel on the server and one HTML document streams
              down. The client never staircases through per-component fetches.
              Watch: a staircase versus a block that snaps in.
            </p>
          </div>

          <div class="hx-cols2">
            {/* LEFT: fetch in components (the staircase). Chained bars; the UI
                regions only fill late, after the last request lands. */}
            <div class="hx-panel">
              <p class="hx-panel__cap">fetch in components</p>
              <BrowserFrame url="example.app / projects">
                <Region showAt={0.55} skeleton={<span class="hx-sk-line" />}>
                  <strong>Projects</strong>
                </Region>
                <Region showAt={0.72} skeleton={<span class="hx-sk-line" />}>
                  Q3 Sales
                </Region>
                <Region showAt={0.9} skeleton={<span class="hx-sk-line" />}>
                  Invoice #102000
                </Region>
              </BrowserFrame>
              <Wire caption="network - fetch in components">
                <Lane label="document" start={0} size={0.12} />
                <Lane label="root.js" start={0.12} size={0.12} />
                <Lane label="data.json" start={0.24} size={0.16} />
                <Lane label="sales.js" start={0.4} size={0.16} />
                <Lane label="invoice.json" start={0.56} size={0.22} />
              </Wire>
            </div>

            {/* RIGHT: hono-preact SSR (the parallel block). Document and loaders
                start together (gradient tone); the UI snaps in far earlier. */}
            <div class="hx-panel">
              <p class="hx-panel__cap">hono-preact SSR</p>
              <BrowserFrame url="example.app / projects">
                <Region showAt={0.32} skeleton={<span class="hx-sk-line" />}>
                  <strong>Projects</strong>
                </Region>
                <Region showAt={0.34} skeleton={<span class="hx-sk-line" />}>
                  Q3 Sales
                </Region>
                <Region showAt={0.36} skeleton={<span class="hx-sk-line" />}>
                  Invoice #102000
                </Region>
              </BrowserFrame>
              <Wire caption="network - hono-preact SSR">
                <Lane label="document" start={0} size={0.3} tone="grad" />
                <Lane label="loaders" start={0} size={0.26} tone="grad" />
                <Lane label="hydrate.js" start={0.04} size={0.24} tone="grad" />
              </Wire>
            </div>
          </div>

          <pre class="hx-code"><code>{snippet}</code></pre>
        </div>
      </ScrollStage>
    </section>
  );
}
```

Append to `apps/site/src/styles/home.css` (tokens only; the code block gets its own `overflow-x: auto` so the page body never scrolls horizontally):

```css
/* Chapter: SSR, no client waterfall (Task 9) */
.hx-panel {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}
.hx-panel__cap {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.hx-sk-line {
  display: block;
  height: 0.6rem;
  border-radius: 0.3rem;
  background: var(--surface-subtle);
}
.hx-code {
  margin-top: 1.2rem;
  overflow-x: auto;
  border: 1px solid var(--border-color);
  border-radius: 0.6rem;
  background: var(--code-surface);
  padding: 0.9rem 1rem;
  font-family: ui-monospace, monospace;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--foreground);
}
```
- [ ] **Step 4: Run the test to verify it passes**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterSSR.test.tsx
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add apps/site/src/components/home/chapters/ChapterSSR.tsx apps/site/src/components/home/chapters/__tests__/ChapterSSR.test.tsx apps/site/src/styles/home.css
git commit -m "feat(site): SSR chapter"
```

---

### Task 10: Streaming, live

**Files:**
- Create: apps/site/src/components/home/chapters/ChapterStreaming.tsx
- Test: apps/site/src/components/home/chapters/__tests__/ChapterStreaming.test.tsx
- Modify: apps/site/src/styles/home.css  <- appends a small chapter-scoped block (tokens only)

**Interfaces:**
- Consumes: `ScrollStage`, `useStageProgress` (from `../scroll/stage.js`); `BrowserFrame`, `Region`, `Wire`, `Lane` (from `../scroll/primitives.js`)
- Produces: `export function ChapterStreaming(): VNode`

- [ ] **Step 1: Write the failing test**
```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ChapterStreaming } from '../ChapterStreaming.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// A >=6-word contiguous slice of the real desc copy.
const DESC_SUBSTRING = 'folds into live UI as it lands';

describe('ChapterStreaming', () => {
  it('renders the heading, the streaming claim, and the device body', () => {
    const { container } = render(<ChapterStreaming />);

    const heading = container.querySelector('h2.hx-scene__title');
    expect(heading?.textContent).toBe('Data that streams in.');

    const desc = container.querySelector('p.hx-scene__desc');
    expect(desc?.textContent).toContain(DESC_SUBSTRING);

    // Device chapter: the streaming body mounts inside the BrowserFrame.
    expect(container.querySelector('.hx-stream')).not.toBeNull();
  });

  it('still renders heading and copy with reduced motion (static frame)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }));

    const { container } = render(<ChapterStreaming />);

    expect(container.querySelector('h2.hx-scene__title')?.textContent).toBe(
      'Data that streams in.'
    );
    expect(container.querySelector('p.hx-scene__desc')?.textContent).toContain(
      DESC_SUBSTRING
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterStreaming.test.tsx
Expected: FAIL (cannot resolve `../ChapterStreaming.js`; the module does not exist yet).

- [ ] **Step 3: Write the component**
```tsx
import type { VNode } from 'preact';
import { ScrollStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame, Region, Wire, Lane } from '../scroll/primitives.js';

// Real framework snippet (a streaming async-generator loader + its live View).
const FEED_SNIPPET = `export const serverLoaders = {
  feed: defineLoader(async function* ({ signal }) {
    while (!signal.aborted) yield await snapshot();
  }),
};
const Live = serverLoaders.feed.View(
  (s) => (s.status === 'open' ? <Count n={s.data} /> : <Connecting />),
  { initial: null, reduce: (_, snap) => snap }
);`;

// Reads the stage playhead and animates a big streaming count. Must live inside
// <ScrollStage> so useStageProgress resolves to the stage playhead.
function LiveCount(): VNode {
  const { progress } = useStageProgress();
  const n = Math.floor(progress * 1284);
  return (
    <div class="hx-stream__count" aria-hidden="true">
      {n.toLocaleString()}
    </div>
  );
}

export function ChapterStreaming(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene__head">
        <p class="hx-scene__step">RPC 02 / Stream</p>
        <h2 class="hx-scene__title">Data that streams in.</h2>
        <p class="hx-scene__desc">
          A loader can be an async generator. Each yield frames over SSE (or is
          SSR-pumped inline) and folds into live UI as it lands.
        </p>
      </div>

      <pre class="hx-scene__code">
        <code>{FEED_SNIPPET}</code>
      </pre>

      <ScrollStage
        pages={2.6}
        pagesNarrow={2}
        fallbackProgress={1}
        label="Streaming loader feed"
      >
        <div class="hx-panels hx-cols2">
          <BrowserFrame url="/demo/projects/:projectId/tasks/:taskId" live>
            <div class="hx-stream">
              <LiveCount />
              <Region
                showAt={0.35}
                skeleton={<div class="hx-skel hx-skel--list" />}
              >
                <ul class="hx-stream__list">
                  <li>Ship the streaming loader</li>
                  <li>Fold snapshots in order of arrival</li>
                  <li>Reconnect on drop</li>
                </ul>
              </Region>
              <Region
                showAt={0.62}
                skeleton={<div class="hx-skel hx-skel--head" />}
              >
                <header class="hx-stream__header">Live feed: open</header>
              </Region>
              <Region
                showAt={0.92}
                skeleton={<div class="hx-skel hx-skel--chart" />}
              >
                <div class="hx-stream__chart">Throughput trending up</div>
              </Region>
            </div>
          </BrowserFrame>

          <Wire caption="network: SSE">
            <Lane label="GET /feed" start={0} size={0.1} tone="grad" />
            <Lane label="list" start={0.12} size={0.25} />
            <Lane label="header" start={0.1} size={0.5} />
            <Lane label="chart" start={0.14} size={0.76} />
          </Wire>
        </div>
      </ScrollStage>
    </section>
  );
}
```

Append to `apps/site/src/styles/home.css` (tokens only, no interactive elements so no tap-target rule needed; the `<pre>` scrolls internally so the body never scrolls sideways):
```css
/* Chapter: Streaming, live */
.hx-stream {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
}
.hx-stream__count {
  font: 700 clamp(2.5rem, 8vw, 4rem) / 1 var(--font-sans);
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.hx-stream__list {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--muted);
  display: grid;
  gap: 0.35rem;
}
.hx-stream__header {
  font-weight: 600;
  color: var(--accent);
}
.hx-stream__chart {
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: var(--surface-subtle);
  color: var(--muted);
}
.hx-skel {
  border-radius: 0.5rem;
  background: var(--surface-subtle);
  min-height: 1.5rem;
}
.hx-skel--list {
  min-height: 4rem;
}
.hx-skel--head {
  min-height: 2rem;
}
.hx-skel--chart {
  min-height: 3rem;
}
.hx-scene__code {
  margin: 1rem 0 0;
  padding: 1rem;
  overflow-x: auto;
  border-radius: 0.5rem;
  background: var(--code-surface);
  color: var(--foreground);
  font: 0.85rem / 1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

- [ ] **Step 4: Run the test to verify it passes**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterStreaming.test.tsx
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/site/src/components/home/chapters/ChapterStreaming.tsx apps/site/src/components/home/chapters/__tests__/ChapterStreaming.test.tsx apps/site/src/styles/home.css
git commit -m "feat(site): streaming chapter"
```

---

### Task 11: Mutations without the cliff

**Files:**
- Create: apps/site/src/components/home/chapters/ChapterMutations.tsx
- Test: apps/site/src/components/home/chapters/__tests__/ChapterMutations.test.tsx
- Modify: apps/site/src/styles/home.css  <- append the chapter-specific rules

**Interfaces:**
- Consumes: `ScrollStage` (from ../scroll/stage.js); `BrowserFrame`, `Region`, `Wire`, `Lane`, `Reveal` (from ../scroll/primitives.js)
- Produces: `export function ChapterMutations(): VNode`

- [ ] **Step 1: Write the failing test**
```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ChapterMutations } from '../ChapterMutations.js';

// A >=6-word exact substring of the real desc copy.
const CLAIM = 'a resubmission race is cancelled, then loaders revalidate by reference';

function stubMatchMedia(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && /reduce/.test(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', NoopObserver);
  vi.stubGlobal('ResizeObserver', NoopObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterMutations', () => {
  it('renders the heading, the claim copy, and the mutation device UI', () => {
    stubMatchMedia(false);
    const { container, getByText } = render(<ChapterMutations />);

    const heading = getByText('Mutations without the cliff.');
    expect(heading.tagName).toBe('H2');
    expect(heading.className).toContain('hx-scene__title');

    const desc = container.querySelector('.hx-scene__desc');
    expect(desc?.textContent ?? '').toContain(CLAIM);

    // Device chapter: the browser frame renders the task list plus the Add control.
    expect(container.querySelector('.hx-mut-list')).not.toBeNull();
    expect(container.querySelector('.hx-mut-row')).not.toBeNull();
    expect(container.querySelector('.hx-mut-add')).not.toBeNull();
  });

  it('still renders the heading, copy, and device frame with reduced motion (static frame)', () => {
    stubMatchMedia(true);
    const { container, getByText } = render(<ChapterMutations />);

    const heading = getByText('Mutations without the cliff.');
    expect(heading.tagName).toBe('H2');

    const desc = container.querySelector('.hx-scene__desc');
    expect(desc?.textContent ?? '').toContain(CLAIM);

    // The static frame still renders the mutation device UI.
    expect(container.querySelector('.hx-mut-list')).not.toBeNull();
  });
});
```
- [ ] **Step 2: Run the test to verify it fails**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterMutations.test.tsx
Expected: FAIL (cannot resolve `../ChapterMutations.js`).
- [ ] **Step 3: Write the component**
```tsx
import type { VNode } from 'preact';
import { ScrollStage } from '../scroll/stage.js';
import { BrowserFrame, Region, Wire, Lane, Reveal } from '../scroll/primitives.js';

const STEP = 'RPC 03 / Action';
const TITLE = 'Mutations without the cliff.';
const DESC =
  'A mutation is a Form plus defineAction. The UI patches instantly, the server runs, a resubmission race is cancelled, then loaders revalidate by reference. The same markup works with JS off.';

const SNIPPET = `const { mutate, pending } = useAction(serverActions.addTask, {
  invalidate: 'auto',
  onMutate: (t) => addOptimistic(t),
  onError: (_e, h) => h.revert(),
});
// <Form action={serverActions.addTask}> also works with JavaScript disabled`;

export function ChapterMutations(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene">
        <header class="hx-scene__head">
          <p class="hx-scene__step">{STEP}</p>
          <h2 class="hx-scene__title">{TITLE}</h2>
          <p class="hx-scene__desc">{DESC}</p>
        </header>
        <div class="hx-panels hx-cols2">
          <ScrollStage pages={3} pagesNarrow={2} label="Mutation lifecycle">
            <BrowserFrame url="/projects/acme">
              <div class="hx-mut-form">
                <span class="hx-mut-input">Design the landing hero</span>
                <button type="button" class="hx-mut-add">
                  Add
                </button>
              </div>
              <ul class="hx-mut-list">
                <li class="hx-mut-row">Wire up the RPC client</li>
                <Region
                  showAt={0.2}
                  skeleton={
                    <li class="hx-mut-row hx-mut-row--pending" aria-hidden="true" />
                  }
                >
                  <li class="hx-mut-row hx-mut-row--optimistic">
                    <span>Design the landing hero</span>
                    <span class="hx-mut-tag">saving</span>
                  </li>
                </Region>
                <Region
                  showAt={0.85}
                  skeleton={
                    <li class="hx-mut-row hx-mut-row--pending" aria-hidden="true" />
                  }
                >
                  <li class="hx-mut-row hx-mut-row--saved">
                    <span>Design the landing hero</span>
                    <span class="hx-mut-tag hx-mut-tag--ok">saved</span>
                  </li>
                </Region>
              </ul>
            </BrowserFrame>
            <Wire caption="network: mutation + revalidate">
              <Lane label="POST /projects" start={0.05} size={0.32} tone="accent" />
              <Lane label="POST (dup)" start={0.16} size={0.2} cancelAt={0.34} />
              <Lane label="POST /__loaders" start={0.5} size={0.34} tone="grad" />
            </Wire>
          </ScrollStage>
          <Reveal>
            <pre class="hx-code">
              <code>{SNIPPET}</code>
            </pre>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
```

Append these rules to `apps/site/src/styles/home.css` (tokens only for color; the 44px minimums are tap-target requirements):
```css
/* Chapter: Mutations without the cliff */
.hx-mut-form {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
  margin-block-end: 0.75rem;
}
.hx-mut-input {
  flex: 1 1 auto;
  min-block-size: 44px;
  display: flex;
  align-items: center;
  padding-inline: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--surface-subtle);
  color: var(--muted);
}
.hx-mut-add {
  min-block-size: 44px;
  min-inline-size: 44px;
  padding-inline: 1rem;
  border: 0;
  border-radius: 0.5rem;
  background: var(--accent);
  color: var(--accent-foreground);
  font: inherit;
  cursor: pointer;
}
.hx-mut-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.hx-mut-row {
  min-block-size: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding-inline: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--surface);
  color: var(--foreground);
}
.hx-mut-row--pending {
  opacity: 0.4;
}
.hx-mut-row--optimistic {
  border-style: dashed;
  opacity: 0.7;
}
.hx-mut-tag {
  font-size: 0.75rem;
  color: var(--muted);
}
.hx-mut-tag--ok {
  padding-inline: 0.5rem;
  border-radius: 0.375rem;
  background: var(--badge-success-surface);
  color: var(--badge-success-foreground);
}
.hx-code {
  margin: 0;
  padding: 1rem;
  border-radius: 0.5rem;
  background: var(--code-surface);
  overflow-x: auto;
  font-size: 0.8125rem;
}
```
- [ ] **Step 4: Run the test to verify it passes**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterMutations.test.tsx
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add apps/site/src/components/home/chapters/ChapterMutations.tsx apps/site/src/components/home/chapters/__tests__/ChapterMutations.test.tsx apps/site/src/styles/home.css
git commit -m "feat(site): mutations without the cliff chapter"
```

---

### Task 12: Built to degrade, not crash

**Files:**
- Create: apps/site/src/components/home/chapters/ChapterResilience.tsx
- Test: apps/site/src/components/home/chapters/__tests__/ChapterResilience.test.tsx
- Modify: apps/site/src/styles/home.css  (append the small `.hx-res*` chapter rules)

**Interfaces:**
- Consumes: `ScrollStage`, `useStageProgress` (from '../scroll/stage.js'); `BrowserFrame`, `Wire`, `Lane` (from '../scroll/primitives.js')
- Produces: `export function ChapterResilience(): VNode`

- [ ] **Step 1: Write the failing test**
```tsx
// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { ChapterResilience } from '../ChapterResilience.js';

// The kit's reduced-motion / narrow hooks call matchMedia during render; happy-dom
// needs a deterministic stub. reduce=true reports the reduced-motion query as matched.
function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce ? query.includes('reduce') : false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterResilience', () => {
  it('renders the heading, the claim copy, and the resilient demo device', () => {
    stubMatchMedia(false);
    const { container } = render(<ChapterResilience />);

    const heading = container.querySelector('.hx-scene__title');
    expect(heading?.textContent).toContain('Built to degrade, not crash');

    const desc = (
      container.querySelector('.hx-scene__desc')?.textContent ?? ''
    ).replace(/\s+/g, ' ');
    expect(desc).toContain(
      'stale-while-revalidate and keep-last-good-value are the default'
    );

    // Device structure: the demo app inside the BrowserFrame renders its own
    // markup (.hx-res root + three panes), so assert on that rather than on the
    // kit's internal frame/lane class names.
    const device = container.querySelector('.hx-res');
    expect(device).not.toBeNull();
    expect(container.querySelectorAll('.hx-res__pane')).toHaveLength(3);
  });

  it('still renders heading, copy, and the static demo device with reduced motion', () => {
    stubMatchMedia(true);
    const { container } = render(<ChapterResilience />);

    const heading = container.querySelector('.hx-scene__title');
    expect(heading?.textContent).toContain('Built to degrade, not crash');

    const desc = (
      container.querySelector('.hx-scene__desc')?.textContent ?? ''
    ).replace(/\s+/g, ' ');
    expect(desc).toContain(
      'stale-while-revalidate and keep-last-good-value are the default'
    );

    // The kit keeps a static fallback frame under reduced motion, so the demo
    // device and its panes must still be present.
    const device = container.querySelector('.hx-res');
    expect(device).not.toBeNull();
    expect(container.querySelectorAll('.hx-res__pane')).toHaveLength(3);
  });
});
```
- [ ] **Step 2: Run the test to verify it fails**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterResilience.test.tsx
Expected: FAIL (cannot resolve '../ChapterResilience.js').
- [ ] **Step 3: Write the component**
```tsx
import type { VNode } from 'preact';
import { ScrollStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame, Wire, Lane } from '../scroll/primitives.js';

const SNIPPET = `serverLoaders.default.View((state) => {
  switch (state.status) {
    case 'loading': return <Skeleton />;
    case 'revalidating': // keeps the last value
    case 'success': return <List items={state.data} />;
    case 'error': return <Retry onRetry={useReload().reload} />;
  }
});`;

type Status = 'loading' | 'success' | 'revalidating' | 'error';

// Status windows across the stage playhead: loading < .25, success < .5,
// revalidating < .75, else error. During revalidating the last value stays
// on screen; at error a single pane flips to a contained error boundary.
function statusFor(progress: number): Status {
  if (progress < 0.25) return 'loading';
  if (progress < 0.5) return 'success';
  if (progress < 0.75) return 'revalidating';
  return 'error';
}

// Inner child: reads the stage playhead to drive the status chip and to flip
// exactly one pane to a contained error boundary once the playhead reaches the
// error window. The other two panes stay intact, which is the whole point.
function ResilienceApp(): VNode {
  const { progress } = useStageProgress();
  const status = statusFor(progress);
  const errored = status === 'error';
  return (
    <div class="hx-res">
      <div class="hx-res__bar">
        <span class="hx-res__chip" data-state={status}>
          {status}
        </span>
        <span class="hx-res__note">keeps last good value</span>
      </div>
      <div class="hx-res__panes">
        <div class="hx-res__pane">Overview</div>
        {errored ? (
          <div class="hx-res__pane hx-res__pane--error" role="status">
            This pane hit an error
          </div>
        ) : (
          <div class="hx-res__pane">Tasks</div>
        )}
        <div class="hx-res__pane">Activity</div>
      </div>
    </div>
  );
}

export function ChapterResilience(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene">
        <div class="hx-scene__head">
          <p class="hx-scene__step">Resilience</p>
          <h2 class="hx-scene__title">Built to degrade, not crash.</h2>
          <p class="hx-scene__desc">
            Loading, revalidating, and error are a discriminated union you match
            on: stale-while-revalidate and keep-last-good-value are the default,
            and a route error boundary contains a failure to its own pane.
          </p>
        </div>
        <div class="hx-panels hx-cols2">
          <pre class="hx-res__code">
            <code>{SNIPPET}</code>
          </pre>
          <ScrollStage
            pages={2.4}
            pagesNarrow={2}
            fallbackProgress={0.6}
            label="Resilience: match on loading, revalidating, and error"
          >
            <BrowserFrame url="/demo/projects/:projectId/tasks/:taskId">
              <ResilienceApp />
            </BrowserFrame>
            <Wire caption="reload()">
              <Lane label="reload()" start={0.75} size={0.2} tone="accent" />
            </Wire>
          </ScrollStage>
        </div>
      </div>
    </section>
  );
}
```

Append to apps/site/src/styles/home.css (tokens only; panes and chip are non-interactive, so no tap-target minimum applies; the `<pre>` scrolls within itself so the body never scrolls sideways):
```css
/* Chapter: Built to degrade, not crash (ChapterResilience) */
.hx-res {
  display: grid;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--surface-subtle);
}
.hx-res__bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.hx-res__chip {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  color: var(--foreground);
  background: var(--surface);
  text-transform: capitalize;
}
.hx-res__chip[data-state='success'] {
  background: var(--badge-success-surface);
  color: var(--badge-success-foreground);
  border-color: transparent;
}
.hx-res__chip[data-state='revalidating'] {
  background: var(--accent);
  color: var(--accent-foreground);
  border-color: transparent;
}
.hx-res__chip[data-state='error'] {
  color: var(--danger);
  border-color: var(--danger);
  background: var(--surface);
}
.hx-res__note {
  font-size: 0.75rem;
  color: var(--muted);
}
.hx-res__panes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}
.hx-res__pane {
  min-height: 3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  font-size: 0.8125rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--surface);
  color: var(--foreground);
}
.hx-res__pane--error {
  border-color: var(--danger);
  color: var(--danger);
}
.hx-res__code {
  margin: 0;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  background: var(--code-surface);
  border-radius: 0.5rem;
  font-size: 0.8125rem;
  line-height: 1.5;
}
```
- [ ] **Step 4: Run the test to verify it passes**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterResilience.test.tsx
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add apps/site/src/components/home/chapters/ChapterResilience.tsx apps/site/src/components/home/chapters/__tests__/ChapterResilience.test.tsx apps/site/src/styles/home.css
git commit -m "feat(site): resilience chapter"
```

---

### Task 13: Instant navigation

**Files:**
- Create: apps/site/src/components/home/chapters/ChapterPrefetch.tsx
- Test: apps/site/src/components/home/chapters/__tests__/ChapterPrefetch.test.tsx
- Modify: apps/site/src/styles/home.css  <- append the small `.hx-prefetch*` block below

**Interfaces:**
- Consumes: `ScrollStage`, `useStageProgress` (from `../scroll/stage.js`); `BrowserFrame`, `Region` (from `../scroll/primitives.js`); `clamp01` (from `../scroll/progress.js`)
- Produces: `export function ChapterPrefetch(): VNode`

- [ ] **Step 1: Write the failing test**
```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ChapterPrefetch } from '../ChapterPrefetch.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterPrefetch', () => {
  it('renders the heading, the true-claim copy, and the browser device', () => {
    const { container, getByRole } = render(<ChapterPrefetch />);

    expect(
      getByRole('heading', { level: 2, name: 'Instant navigation.' }),
    ).toBeTruthy();

    const text = container.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain(
      'hands whole-page link prefetch to the browser-native',
    );

    // Device chapter: the BrowserFrame (or a lane) must be present.
    expect(container.querySelector('.hx-browser, .hx-lane')).toBeTruthy();
  });

  it('still renders the heading and copy with reduced motion (static frame)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));

    const { container, getByRole } = render(<ChapterPrefetch />);

    expect(
      getByRole('heading', { level: 2, name: 'Instant navigation.' }),
    ).toBeTruthy();

    const text = container.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain(
      'hands whole-page link prefetch to the browser-native',
    );
  });
});
```
- [ ] **Step 2: Run the test to verify it fails**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterPrefetch.test.tsx
Expected: FAIL (cannot resolve `../ChapterPrefetch.js`).
- [ ] **Step 3: Write the component**

Create `apps/site/src/components/home/chapters/ChapterPrefetch.tsx`:
```tsx
import type { VNode } from 'preact';
import { ScrollStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame, Region } from '../scroll/primitives.js';
import { clamp01 } from '../scroll/progress.js';

const SNIPPET = `// one line in your app config
export default defineApp({ speculation: true });
// or bind a specific link's loader to any intent (hover, focus, touch):
const prefetchIssue = usePrefetch(href, serverLoaders.issue);`;

const WARM_ROWS = ['sales.js', 'invoices.js', 'invoice.json', 'invoice.css'];

// Reads the stage playhead and glides a decorative pointer toward the link.
// Everything derives from progress; there is no real pointer input.
function DemoCursor(): VNode {
  const { progress } = useStageProgress();
  const t = clamp01((progress - 0.1) / 0.55); // travels between .1 and .65
  const left = 14 + t * 44; // 14% -> 58%
  const top = 76 - t * 40; //  76% -> 36%
  return (
    <span
      class="hx-prefetch__cursor"
      aria-hidden="true"
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      <svg viewBox="0 0 12 12" width="18" height="18" aria-hidden="true">
        <path d="M1 1 L1 10 L4 7 L6 11 L8 10 L6 6 L10 6 Z" fill="currentColor" />
      </svg>
    </span>
  );
}

export function ChapterPrefetch(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene">
        <div class="hx-cols2">
          <div class="hx-scene__head">
            <p class="hx-scene__step">Navigation</p>
            <h2 class="hx-scene__title">Instant navigation.</h2>
            <p class="hx-scene__desc">
              Hover warms the cache before the click. hono-preact hands whole-page
              link prefetch to the browser-native Speculation Rules API, plus typed
              usePrefetch on any intent. The live docs site runs it.
            </p>
            <pre class="hx-prefetch__code">
              <code>{SNIPPET}</code>
            </pre>
            <a class="hx-prefetch__demo" href="/docs">
              See it on the live docs
            </a>
          </div>
          <div class="hx-panels">
            <ScrollStage
              pages={2.6}
              pagesNarrow={2}
              unpinOnNarrow
              fallbackProgress={0.95}
              label="Instant navigation demo"
            >
              <BrowserFrame url="example.app / dashboard">
                <div class="hx-prefetch">
                  <div class="hx-prefetch__nav">
                    <span class="hx-prefetch__brand">Acme</span>
                    <span class="hx-prefetch__link">Invoices</span>
                  </div>
                  <DemoCursor />
                  <Region
                    showAt={0.68}
                    skeleton={
                      <p class="hx-prefetch__hint">hover to warm the cache</p>
                    }
                  >
                    <div class="hx-prefetch__pop" role="status">
                      <p class="hx-prefetch__pop-head">Prefetching in parallel</p>
                      <ul class="hx-prefetch__rows">
                        {WARM_ROWS.map((name) => (
                          <li key={name} class="hx-prefetch__row">
                            <code>{name}</code>
                            <span class="hx-prefetch__ready">ready</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Region>
                  <Region
                    showAt={0.9}
                    skeleton={
                      <div
                        class="hx-prefetch__dest hx-prefetch__dest--wait"
                        aria-hidden="true"
                      />
                    }
                  >
                    <div class="hx-prefetch__dest">
                      <p class="hx-prefetch__dest-title">Invoice INV-204</p>
                      <p class="hx-prefetch__dest-line">
                        Rendered from warm cache. No spinner.
                      </p>
                    </div>
                  </Region>
                </div>
              </BrowserFrame>
            </ScrollStage>
          </div>
        </div>
      </div>
    </section>
  );
}
```

Append to `apps/site/src/styles/home.css` (tokens only; radii in rem since there is no radius token):
```css
/* Chapter: Instant navigation (prefetch) */
.hx-prefetch {
  position: relative;
  min-height: 12rem;
  padding: 1rem;
  font-family: var(--font-sans);
}
.hx-prefetch__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border-color);
  color: var(--foreground);
}
.hx-prefetch__brand {
  font-weight: 600;
}
.hx-prefetch__link {
  color: var(--accent);
  font-weight: 600;
}
.hx-prefetch__hint {
  margin-top: 2rem;
  color: var(--muted);
  font-size: 0.85rem;
}
.hx-prefetch__cursor {
  position: absolute;
  z-index: 3;
  color: var(--foreground);
  pointer-events: none;
}
.hx-prefetch__pop {
  margin-top: 1rem;
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--surface);
  box-shadow: var(--shadow-card);
}
.hx-prefetch__pop-head {
  margin: 0 0 0.5rem;
  color: var(--muted);
  font-size: 0.8rem;
}
.hx-prefetch__rows {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.hx-prefetch__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: var(--foreground);
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
}
.hx-prefetch__ready {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--badge-success-surface);
  color: var(--badge-success-foreground);
  font-family: var(--font-sans);
  font-size: 0.7rem;
}
.hx-prefetch__dest {
  margin-top: 1rem;
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--surface-subtle);
  color: var(--foreground);
}
.hx-prefetch__dest--wait {
  min-height: 3rem;
  opacity: 0.4;
}
.hx-prefetch__dest-title {
  margin: 0 0 0.25rem;
  font-weight: 600;
}
.hx-prefetch__dest-line {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}
.hx-prefetch__code {
  margin: 1rem 0 0;
  padding: 0.85rem 1rem;
  overflow-x: auto;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--code-surface);
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
  line-height: 1.5;
}
.hx-prefetch__demo {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-top: 0.75rem;
  padding: 0 1rem;
  border-radius: 0.5rem;
  background: var(--accent);
  color: var(--accent-foreground);
  font-weight: 600;
  text-decoration: none;
}
```
- [ ] **Step 4: Run the test to verify it passes**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterPrefetch.test.tsx
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add apps/site/src/components/home/chapters/ChapterPrefetch.tsx apps/site/src/components/home/chapters/__tests__/ChapterPrefetch.test.tsx apps/site/src/styles/home.css
git commit -m "feat(site): instant-navigation chapter"
```

---

### Task 14: Transitions, for free

**Files:**
- Create: apps/site/src/components/home/chapters/ChapterTransitions.tsx
- Test: apps/site/src/components/home/chapters/__tests__/ChapterTransitions.test.tsx
- Modify: apps/site/src/styles/home.css  (append the widget + ::view-transition rules)

**Interfaces:**
- Consumes: `usePrefersReducedMotion` (from `../scroll/motion.js`), `BrowserFrame` (from `../scroll/primitives.js`), `document.startViewTransition` (real DOM API, feature-checked). NO ScrollStage/Actor/LiveStage.
- Produces: `export function ChapterTransitions(): VNode`

- [ ] **Step 1: Write the failing test**
```tsx
// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { ChapterTransitions } from '../ChapterTransitions.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Mirrors the matchMedia stub shape used in HeroShader.test.tsx so the kit's
// usePrefersReducedMotion() sees a deterministic reduce value.
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));
}

describe('ChapterTransitions', () => {
  it('renders the heading, the true-claim copy, and the browser frame', () => {
    const { container } = render(<ChapterTransitions />);
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /Transitions, for free\./,
      })
    ).toBeTruthy();
    // >= 6-word contiguous substring of the real desc copy.
    expect(
      screen.getByText(
        /wraps every client route change in a view transition automatically/
      )
    ).toBeTruthy();
    // Device chapter: the interactive widget lives inside a BrowserFrame.
    expect(container.querySelector('.hx-browser')).toBeTruthy();
  });

  it('still renders heading and copy with reduced motion (static fallback)', () => {
    stubMatchMedia(true);
    render(<ChapterTransitions />);
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /Transitions, for free\./,
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        /wraps every client route change in a view transition automatically/
      )
    ).toBeTruthy();
  });
});
```
- [ ] **Step 2: Run the test to verify it fails**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterTransitions.test.tsx
Expected: FAIL (cannot resolve `../ChapterTransitions.js`).
- [ ] **Step 3: Write the component (and append the CSS)**

Create apps/site/src/components/home/chapters/ChapterTransitions.tsx:
```tsx
import { useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { usePrefersReducedMotion } from '../scroll/motion.js';
import { BrowserFrame } from '../scroll/primitives.js';

type Card = { id: string; title: string; meta: string; body: string };

const CARDS: Card[] = [
  {
    id: 'auth',
    title: 'Ship the auth flow',
    meta: 'Web, In progress',
    body: 'Wire the session cookie, gate the dashboard, and add the sign-out route.',
  },
  {
    id: 'search',
    title: 'Fix search ranking',
    meta: 'API, In review',
    body: 'Boost exact-title matches and de-duplicate results before paging.',
  },
  {
    id: 'billing',
    title: 'Draft the billing page',
    meta: 'Web, Backlog',
    body: 'Lay out the plan cards, wire the upgrade action, and show the invoice list.',
  },
];

const DESC =
  'hono-preact wraps every client route change in a view transition automatically: no per-link opt-in, direction-aware slides, and shared-element morphs where a card grows into the page. Try it here, then feel the real thing in the demo.';

// Stored as plain single-quoted lines (not a template literal) so the backticks
// and the `${task.id}` interpolation stay literal in the rendered code sample.
const SNIPPET = [
  '// You write nothing: every client route change is wrapped in a view',
  '// transition automatically. You do not opt in.',
  '//',
  '// Direction-aware, in CSS (framework adds nav-back / nav-forward types):',
  '//   :active-view-transition-type(nav-back) ::view-transition-old(root) {',
  '//     animation: slide-right-out 0.3s ease;',
  '//   }',
  '//',
  '// Morph a card into its detail page (shared element):',
  '//   <ViewTransitionName name={`task-${task.id}`} render={<header />}>',
  '//     <h1>{task.title}</h1>',
  '//   </ViewTransitionName>',
].join('\n');

export function ChapterTransitions(): VNode {
  const reduced = usePrefersReducedMotion();
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dir, setDir] = useState<'forward' | 'back'>('forward');

  function go(next: 'list' | 'detail', id: string | null) {
    const nextDir: 'forward' | 'back' = next === 'detail' ? 'forward' : 'back';
    const apply = () => {
      setDir(nextDir);
      setSelectedId(id);
      setView(next);
    };
    // Real view transition only when the platform supports it AND motion is
    // allowed; otherwise flip state directly so the widget stays fully usable.
    const canAnimate =
      !reduced &&
      typeof document !== 'undefined' &&
      typeof document.startViewTransition === 'function';
    if (canAnimate) {
      // Drives the direction-aware ::view-transition slide in home.css.
      document.documentElement.setAttribute('data-hx-dir', nextDir);
      const transition = document.startViewTransition(async () => {
        apply();
        // Let Preact commit before the browser snapshots the "new" state.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      });
      transition.finished.finally(() => {
        document.documentElement.removeAttribute('data-hx-dir');
      });
    } else {
      apply();
    }
  }

  const selected = CARDS.find((c) => c.id === selectedId) ?? null;

  return (
    <section class="hx-chapter">
      <div class="hx-scene__head">
        <p class="hx-scene__step">Signature</p>
        <h2 class="hx-scene__title">Transitions, for free.</h2>
        <p class="hx-scene__desc">{DESC}</p>
      </div>

      <div class="hx-cols2">
        <BrowserFrame url="/demo/projects">
          {/* data-dir is declared here for readers; the global ::view-transition
              pseudo-elements are keyed off html[data-hx-dir] set during go(). */}
          <div class="hx-vt" data-dir={dir}>
            {view === 'list' || selected === null ? (
              <ul class="hx-vt__list">
                {CARDS.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      class="hx-vt__card"
                      style={{
                        viewTransitionName: reduced ? undefined : `hx-card-${c.id}`,
                        minHeight: 44,
                      }}
                      onClick={() => go('detail', c.id)}
                    >
                      <span class="hx-vt__card-title">{c.title}</span>
                      <span class="hx-vt__card-meta">{c.meta}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div class="hx-vt__detail">
                <div
                  class="hx-vt__hero"
                  style={{
                    viewTransitionName: reduced
                      ? undefined
                      : `hx-card-${selected.id}`,
                  }}
                >
                  <span class="hx-vt__card-title">{selected.title}</span>
                  <span class="hx-vt__card-meta">{selected.meta}</span>
                </div>
                <p class="hx-vt__body">{selected.body}</p>
                <button
                  type="button"
                  class="hx-vt__back"
                  style={{ minHeight: 44 }}
                  onClick={() => go('list', null)}
                >
                  Back to projects
                </button>
              </div>
            )}
          </div>
        </BrowserFrame>

        <div class="hx-panels">
          <pre class="hx-code">
            <code>{SNIPPET}</code>
          </pre>
          <p class="hx-scene__desc">
            This widget calls <code>document.startViewTransition</code> by hand.
            hono-preact does exactly this for you on every client navigation: no
            opt-in, direction-aware, with shared-element morphs.
          </p>
          <a class="hx-vt__demo" href="/demo/projects">
            Feel the real thing in the demo
          </a>
        </div>
      </div>
    </section>
  );
}
```

Append to apps/site/src/styles/home.css:
```css
/* ---- Chapter: Transitions, for free (interactive VT widget) ---- */
.hx-vt {
  display: grid;
  gap: 8px;
  view-transition-name: hx-vt-panel;
}
.hx-vt__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.hx-vt__card,
.hx-vt__back,
.hx-vt__demo {
  display: flex;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--surface);
  color: var(--foreground);
  font: inherit;
  cursor: pointer;
}
.hx-vt__card {
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
.hx-vt__card:hover {
  background: var(--surface-subtle);
}
.hx-vt__card-title {
  font-weight: 600;
}
.hx-vt__card-meta {
  color: var(--muted);
  font-size: 0.85em;
}
.hx-vt__detail {
  display: grid;
  gap: 10px;
}
.hx-vt__hero {
  padding: 14px;
  border-radius: 12px;
  background: var(--accent);
  color: var(--accent-foreground);
}
.hx-vt__hero .hx-vt__card-meta {
  color: var(--accent-foreground);
  opacity: 0.85;
}
.hx-vt__body {
  margin: 0;
  color: var(--foreground);
}
.hx-vt__back,
.hx-vt__demo {
  align-items: center;
  justify-content: center;
}
.hx-vt__demo {
  text-decoration: none;
  background: var(--surface-subtle);
}

/* Shared-element morph is automatic: the tapped card and the detail hero share
   view-transition-name hx-card-<id>. The panel slides, keyed by direction. */
::view-transition-group(hx-vt-panel) {
  animation-duration: 260ms;
}
html[data-hx-dir='forward']::view-transition-old(hx-vt-panel) {
  animation: hx-vt-out-left 260ms both;
}
html[data-hx-dir='forward']::view-transition-new(hx-vt-panel) {
  animation: hx-vt-in-right 260ms both;
}
html[data-hx-dir='back']::view-transition-old(hx-vt-panel) {
  animation: hx-vt-out-right 260ms both;
}
html[data-hx-dir='back']::view-transition-new(hx-vt-panel) {
  animation: hx-vt-in-left 260ms both;
}
@keyframes hx-vt-out-left {
  to {
    transform: translateX(-24px);
    opacity: 0;
  }
}
@keyframes hx-vt-in-right {
  from {
    transform: translateX(24px);
    opacity: 0;
  }
}
@keyframes hx-vt-out-right {
  to {
    transform: translateX(24px);
    opacity: 0;
  }
}
@keyframes hx-vt-in-left {
  from {
    transform: translateX(-24px);
    opacity: 0;
  }
}

/* Reduced motion: strip the panel name so nothing is captured, and kill any
   animation. The card/hero names are already withheld in JS when reduced, so
   the list <-> detail widget stays fully usable as plain state. */
@media (prefers-reduced-motion: reduce) {
  .hx-vt {
    view-transition-name: none;
  }
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none !important;
  }
}
```
- [ ] **Step 4: Run the test to verify it passes**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterTransitions.test.tsx
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add apps/site/src/components/home/chapters/ChapterTransitions.tsx apps/site/src/components/home/chapters/__tests__/ChapterTransitions.test.tsx apps/site/src/styles/home.css
git commit -m "feat(site): transitions chapter"
```

---

### Task 15: Live, both ways

**Files:**
- Create: apps/site/src/components/home/chapters/ChapterRealtime.tsx
- Test: apps/site/src/components/home/chapters/__tests__/ChapterRealtime.test.tsx
- Modify: apps/site/src/styles/home.css  (append the small `.hx-rt-*` block below)

**Interfaces:**
- Consumes: `LiveStage`, `useStageProgress` (from `../scroll/stage.js`); `BrowserFrame`, `Wire`, `Lane` (from `../scroll/primitives.js`)
- Produces: `export function ChapterRealtime(): VNode`

- [ ] **Step 1: Write the failing test**
```tsx
// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { ChapterRealtime } from '../ChapterRealtime.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterRealtime (Live, both ways)', () => {
  it('renders the heading, a copy substring, and a device surface', () => {
    const { container, getByRole, getByText } = render(<ChapterRealtime />);

    expect(
      getByRole('heading', { name: /live, both ways/i })
    ).toBeInTheDocument();

    expect(
      getByText(/reach for a WebSocket when the browser must talk back/i)
    ).toBeInTheDocument();

    // Device chapter: a live device surface must render. `.hx-rt-room` is this
    // chapter's own live-room surface (rendered inside the BrowserFrame), so the
    // assertion holds on markup this task owns; `.hx-browser` is the kit frame.
    expect(container.querySelector('.hx-browser, .hx-rt-room')).not.toBeNull();
  });

  it('still renders the heading and copy with reduced motion (static frame)', () => {
    // usePrefersReducedMotion reads matchMedia('(prefers-reduced-motion: reduce)').
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));

    const { getByRole, getByText } = render(<ChapterRealtime />);

    expect(
      getByRole('heading', { name: /live, both ways/i })
    ).toBeInTheDocument();

    expect(
      getByText(/reach for a WebSocket when the browser must talk back/i)
    ).toBeInTheDocument();
  });
});
```
- [ ] **Step 2: Run the test to verify it fails**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterRealtime.test.tsx
Expected: FAIL (cannot resolve the component: `../ChapterRealtime.js` does not exist yet).
- [ ] **Step 3: Write the component**
```tsx
import type { VNode } from 'preact';
import { LiveStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame, Wire, Lane } from '../scroll/primitives.js';

// Rendered literally in a <pre>. Inner backticks and ${...} are escaped so the
// template literal reproduces the framework snippet verbatim.
const CODE = `const chat = defineSocket({
  data: (c) => ({ name: c.get('user').name }),
  message: (s, m) => s.send({ text: \`\${s.data.name}: \${m.text}\` }),
});
const { send, lastMessage, status } = chat.useSocket();`;

// Progress thresholds at which each frame chip flips from "down" to "up".
const CHIP_THRESHOLDS = [0.2, 0.4, 0.6, 0.8];

// Reads the LiveStage playhead (a looping 0..1 rAF clock) to animate two
// presence cursors, a live tally, and up/down frame chips. Keeps moving
// without any scrolling because LiveStage drives it.
function LiveRoom(): VNode {
  const { progress } = useStageProgress();
  const angle = progress * 2 * Math.PI;
  const ax = 50 + Math.sin(angle) * 34;
  const ay = 50 + Math.cos(angle) * 30;
  const bx = 50 + Math.sin(angle + Math.PI) * 34;
  const by = 50 + Math.cos(angle + Math.PI) * 30;
  const tally = Math.floor(progress * 47);

  return (
    <div class="hx-rt-room">
      <span
        class="hx-rt-cursor"
        style={{ left: `${ax}%`, top: `${ay}%` }}
        aria-hidden="true"
      >
        A
      </span>
      <span
        class="hx-rt-cursor hx-rt-cursor--b"
        style={{ left: `${bx}%`, top: `${by}%` }}
        aria-hidden="true"
      >
        B
      </span>
      <output class="hx-rt-tally">{tally} in room</output>
      <ul class="hx-rt-chips">
        {CHIP_THRESHOLDS.map((threshold, i) => {
          const up = progress >= threshold;
          return (
            <li key={threshold} class="hx-rt-chip" data-dir={up ? 'up' : 'down'}>
              {up ? 'up' : 'down'} frame {i + 1}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ChapterRealtime(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene">
        <div class="hx-scene__head">
          <p class="hx-scene__step">Realtime</p>
          <h2 class="hx-scene__title">Live, both ways.</h2>
          <p class="hx-scene__desc">
            One typed duplex socket per client, with rooms and a presence
            roster. Use SSE when the server only pushes; reach for a WebSocket
            when the browser must talk back. On Cloudflare it fans out through
            one framework-provided Durable Object.
          </p>
        </div>
        <div class="hx-panels hx-cols2">
          <LiveStage periodMs={4200} fallbackProgress={0.5}>
            <BrowserFrame url="/demo/cursors" live>
              <LiveRoom />
            </BrowserFrame>
            <Wire caption="network: WebSocket (duplex, ongoing)">
              <Lane label="WS /__sockets" start={0} size={0.12} tone="grad" />
            </Wire>
          </LiveStage>
          <pre class="hx-code">
            <code>{CODE}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}
```

Append to `apps/site/src/styles/home.css` (tokens only, non-interactive glyphs so the 44px rule does not apply, room clips its own overflow so the body never scrolls sideways):
```css
/* Realtime chapter (live clock) */
.hx-rt-room {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 12px;
  background: var(--surface-subtle);
  overflow: hidden;
}
.hx-rt-cursor {
  position: absolute;
  transform: translate(-50%, -50%);
  min-width: 1.5rem;
  min-height: 1.5rem;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-foreground);
  font: 600 0.75rem/1 var(--font-sans);
}
.hx-rt-cursor--b {
  background: var(--foreground);
  color: var(--background);
}
.hx-rt-tally {
  position: absolute;
  left: 0.75rem;
  bottom: 0.75rem;
  font: 600 0.8125rem/1 var(--font-sans);
  color: var(--muted);
}
.hx-rt-chips {
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  display: grid;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.hx-rt-chip {
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  font: 600 0.75rem/1.4 var(--font-sans);
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--border-color);
}
.hx-rt-chip[data-dir='up'] {
  color: var(--accent-foreground);
  background: var(--accent);
  border-color: transparent;
}
```
- [ ] **Step 4: Run the test to verify it passes**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterRealtime.test.tsx
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add apps/site/src/components/home/chapters/ChapterRealtime.tsx apps/site/src/components/home/chapters/__tests__/ChapterRealtime.test.tsx apps/site/src/styles/home.css
git commit -m "feat(site): realtime chapter"
```

---

### Task 16: One package, typed throughout

**Files:**
- Create: apps/site/src/components/home/chapters/ChapterOnePackage.tsx
- Test: apps/site/src/components/home/chapters/__tests__/ChapterOnePackage.test.tsx
- Modify: apps/site/src/styles/home.css  (add the small pill-row + code rules; tokens only, `overflow-x` on the `<pre>` so wide code never scrolls the body)

**Interfaces:**
- Consumes: `Reveal` (from `'../scroll/primitives.js'`). No `ScrollStage`, `Actor`, `LiveStage`, or `Wire`: this is a calm chapter that reads no playhead, so no inner `useStageProgress()` child is needed.
- Produces: `export function ChapterOnePackage(): VNode`

- [ ] **Step 1: Write the failing test**
```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ChapterOnePackage } from '../ChapterOnePackage.js';

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));
}

// Reveal wires an IntersectionObserver in an effect; happy-dom lacks it, so stub a no-op.
class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IOStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterOnePackage', () => {
  it('renders the heading, the true-claim copy, and the code sample', () => {
    stubMatchMedia(false);
    const { container } = render(<ChapterOnePackage />);

    const heading = container.querySelector('h2.hx-scene__title');
    expect(heading?.textContent).toBe('One package, typed throughout.');

    const desc = container.querySelector('p.hx-scene__desc');
    expect(desc?.textContent).toContain('A single hono-preact install gives you the runtime');

    const code = container.querySelector('pre');
    expect(code?.textContent).toContain("import { honoPreact } from 'hono-preact/vite';");
  });

  it('still renders heading, copy, and the Reveal-wrapped pills with reduced motion (static fallback frame)', () => {
    stubMatchMedia(true);
    const { container } = render(<ChapterOnePackage />);

    expect(container.querySelector('h2.hx-scene__title')?.textContent).toBe(
      'One package, typed throughout.',
    );
    expect(container.querySelector('p.hx-scene__desc')?.textContent).toContain(
      'A single hono-preact install gives you the runtime',
    );

    // The Reveal-wrapped package list is the only animated content, so reduced
    // motion must render it as a static frame (no IO gate withholds it).
    const pills = container.querySelectorAll('.hx-pkg-pill');
    expect(Array.from(pills, (n) => n.textContent)).toEqual([
      'hono-preact',
      'hono-preact/server',
      'hono-preact/vite',
      'hono-preact/adapter-*',
    ]);
  });
});
```
- [ ] **Step 2: Run the test to verify it fails**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterOnePackage.test.tsx
Expected: FAIL (cannot resolve `../ChapterOnePackage.js`).
- [ ] **Step 3: Write the component**
```tsx
import type { VNode } from 'preact';
import { Reveal } from '../scroll/primitives.js';

const SUBPATHS = [
  'hono-preact',
  'hono-preact/server',
  'hono-preact/vite',
  'hono-preact/adapter-*',
] as const;

const SNIPPET = `import { defineRoutes } from 'hono-preact';
import { honoPreact } from 'hono-preact/vite';
import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare';`;

export function ChapterOnePackage(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene">
        <div class="hx-scene__head">
          <span class="hx-scene__step">The whole surface</span>
          <h2 class="hx-scene__title">One package, typed throughout.</h2>
          <p class="hx-scene__desc">A single hono-preact install gives you the runtime, /server, /vite, and both /adapter-* targets. Typed end to end, and every PR measures each feature client-JS cost.</p>
        </div>
        <Reveal>
          <ul class="hx-pkg-row">
            {SUBPATHS.map((path) => (
              <li key={path} class="hx-pkg-pill">
                {path}
              </li>
            ))}
          </ul>
        </Reveal>
        <pre class="hx-pkg-code">
          <code>{SNIPPET}</code>
        </pre>
      </div>
    </section>
  );
}
```
Then append to apps/site/src/styles/home.css (tokens only, keep it small):
```css
/* Chapter: One package, typed throughout */
.hx-pkg-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}
.hx-pkg-pill {
  font-family: var(--font-sans);
  font-size: 0.875rem;
  color: var(--foreground);
  background: var(--surface-subtle);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 0.35rem 0.75rem;
}
.hx-pkg-code {
  margin: 1rem 0 0;
  padding: 1rem;
  overflow-x: auto;
  background: var(--code-surface);
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  font-size: 0.8125rem;
  line-height: 1.6;
}
```
- [ ] **Step 4: Run the test to verify it passes**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterOnePackage.test.tsx
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add apps/site/src/components/home/chapters/ChapterOnePackage.tsx apps/site/src/components/home/chapters/__tests__/ChapterOnePackage.test.tsx apps/site/src/styles/home.css
git commit -m "feat(site): one-package chapter"
```

---

### Task 17: Closing call to action

**Files:**
- Create: apps/site/src/components/home/chapters/ChapterCTA.tsx
- Test: apps/site/src/components/home/chapters/__tests__/ChapterCTA.test.tsx
- Modify: apps/site/src/styles/home.css  (append a few CTA-specific rules; tokens only)

**Interfaces:**
- Consumes: `Reveal` (from `../scroll/primitives.js`). No pinned stage, no device, no `<pre>` (snippet is empty), per the calm-centered spec.
- Produces: `export function ChapterCTA(): VNode`

- [ ] **Step 1: Write the failing test**
```tsx
// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { ChapterCTA } from '../ChapterCTA.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterCTA', () => {
  it('renders the heading, a chunk of the true copy, and both CTA links', () => {
    const { getByRole, container } = render(<ChapterCTA />);

    // Heading is the exact chapter title, rendered as the hx-scene__title h2.
    const heading = getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Build something that feels alive.');

    // A contiguous 11-word substring of the real desc copy is present.
    expect(container.textContent).toContain(
      'Start with the quick start, or poke at the live demo.'
    );

    // Both actions render with the real hrefs (calm centered section).
    const start = getByRole('link', {
      name: 'Get started',
    }) as HTMLAnchorElement;
    const demo = getByRole('link', {
      name: 'See the demo',
    }) as HTMLAnchorElement;
    expect(start.getAttribute('href')).toBe('/docs/quick-start');
    expect(demo.getAttribute('href')).toBe('/demo');
  });

  it('still renders heading + copy under prefers-reduced-motion (static fallback frame)', () => {
    // Stub matchMedia so the reduce query matches; Reveal renders instantly.
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList
    );

    const { getByRole, container } = render(<ChapterCTA />);
    expect(getByRole('heading', { level: 2 }).textContent).toBe(
      'Build something that feels alive.'
    );
    expect(container.textContent).toContain(
      'Start with the quick start, or poke at the live demo.'
    );
  });
});
```
- [ ] **Step 2: Run the test to verify it fails**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterCTA.test.tsx
Expected: FAIL (cannot resolve `../ChapterCTA.js`).
- [ ] **Step 3: Write the component (and append the CTA CSS)**
```tsx
import type { VNode } from 'preact';
import { Reveal } from '../scroll/primitives.js';

export function ChapterCTA(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene hx-cta">
        <Reveal>
          <div class="hx-scene__head">
            <p class="hx-scene__step">Ready?</p>
            <h2 class="hx-scene__title">Build something that feels alive.</h2>
            <p class="hx-scene__desc">
              You have seen the whole connection: fetch, stream, mutate,
              transition, and go live, all typed. Start with the quick start, or
              poke at the live demo.
            </p>
          </div>
          <div class="hx-cta__actions">
            <a
              class="hx-cta__btn hx-cta__btn--primary"
              href="/docs/quick-start"
            >
              Get started
            </a>
            <a class="hx-cta__btn hx-cta__btn--secondary" href="/demo">
              See the demo
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
```
Then append these rules to the end of `apps/site/src/styles/home.css` (tokens only; the two links are >=44px tap targets and wrap instead of overflowing on narrow screens):
```css
/* Closing call to action (ChapterCTA): calm centered section, no pin. */
.hx-cta {
  max-width: 44rem;
  margin-inline: auto;
  text-align: center;
}
.hx-cta__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 1.5rem;
}
.hx-cta__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  min-width: 44px;
  padding: 0 1.25rem;
  border-radius: 0.5rem;
  border: 1px solid transparent;
  font: inherit;
  font-weight: 600;
  text-decoration: none;
}
.hx-cta__btn--primary {
  background: var(--accent);
  color: var(--accent-foreground);
}
.hx-cta__btn--primary:hover {
  background: var(--accent-hover);
}
.hx-cta__btn--secondary {
  background: var(--surface);
  color: var(--foreground);
  border-color: var(--border-color);
}
.hx-cta__btn--secondary:hover {
  background: var(--surface-subtle);
}
.hx-cta__btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
```
- [ ] **Step 4: Run the test to verify it passes**
Run: pnpm vitest run apps/site/src/components/home/chapters/__tests__/ChapterCTA.test.tsx
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add apps/site/src/components/home/chapters/ChapterCTA.tsx apps/site/src/components/home/chapters/__tests__/ChapterCTA.test.tsx apps/site/src/styles/home.css
git commit -m "feat(site): closing call to action chapter"
```

---

### Task 18: Wire the chapters into the shell + full verification

Compose all chapters into `home.tsx` in order, assert every chapter mounts (and survives reduced motion), then run the full CI-parity gate and the responsive checklist. This is the task that turns eleven independent components into the page.

**Files:**
- Modify: `apps/site/src/pages/home.tsx`
- Modify: `apps/site/src/pages/__tests__/home.test.tsx`

**Interfaces:**
- Consumes: `ChapterEdge`, `ChapterRouting`, `ChapterSSR`, `ChapterStreaming`, `ChapterMutations`, `ChapterResilience`, `ChapterPrefetch`, `ChapterTransitions`, `ChapterRealtime`, `ChapterOnePackage`, `ChapterCTA` (Tasks 7-17).
- Produces: the finished `<Home>` page.

- [ ] **Step 1: Extend the home test to assert every chapter mounts and the reduced-motion frame renders**

```tsx
// add to apps/site/src/pages/__tests__/home.test.tsx (inside the existing describe)
import { vi } from 'vitest';

it('mounts all twelve chapters (headings present)', () => {
  render(<Home />);
  for (const re of [
    /edge to browser/i,          // hero
    /runs on the platform/i,     // edge
    /routing is a manifest/i,    // routing
    /no client waterfall/i,      // ssr
    /streams in/i,               // streaming
    /without the cliff/i,        // mutations
    /degrade, not crash/i,       // resilience
    /instant navigation/i,       // prefetch
    /transitions, for free/i,    // view transitions
    /live, both ways/i,          // realtime
    /one package/i,              // one package
    /feels alive/i,              // cta
  ]) {
    expect(screen.getByText(re)).toBeInTheDocument();
  }
});

it('renders coherently with reduced motion (no pinning path)', () => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: /reduce/.test(q),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  render(<Home />);
  expect(screen.getByText(/routing is a manifest/i)).toBeInTheDocument();
  expect(screen.getByText(/live, both ways/i)).toBeInTheDocument();
  vi.restoreAllMocks();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/site/src/pages/__tests__/home.test.tsx`
Expected: FAIL (chapters not yet rendered by the shell).

- [ ] **Step 3: Render the chapters in `home.tsx`**

Add the imports and drop the components into the `<main>` in order, replacing the comment placeholder from Task 6:

```tsx
import { ChapterEdge } from '../components/home/chapters/ChapterEdge.js';
import { ChapterRouting } from '../components/home/chapters/ChapterRouting.js';
import { ChapterSSR } from '../components/home/chapters/ChapterSSR.js';
import { ChapterStreaming } from '../components/home/chapters/ChapterStreaming.js';
import { ChapterMutations } from '../components/home/chapters/ChapterMutations.js';
import { ChapterResilience } from '../components/home/chapters/ChapterResilience.js';
import { ChapterPrefetch } from '../components/home/chapters/ChapterPrefetch.js';
import { ChapterTransitions } from '../components/home/chapters/ChapterTransitions.js';
import { ChapterRealtime } from '../components/home/chapters/ChapterRealtime.js';
import { ChapterOnePackage } from '../components/home/chapters/ChapterOnePackage.js';
import { ChapterCTA } from '../components/home/chapters/ChapterCTA.js';
```

```tsx
        {/* Chapters, in order */}
        <ChapterEdge />
        <ChapterRouting />
        <ChapterSSR />
        <ChapterStreaming />
        <ChapterMutations />
        <ChapterResilience />
        <ChapterPrefetch />
        <ChapterTransitions />
        <ChapterRealtime />
        <ChapterOnePackage />
        <ChapterCTA />
```

- [ ] **Step 4: Run the home test to verify it passes**

Run: `pnpm vitest run apps/site/src/pages/__tests__/home.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full kit + chapter suite**

Run: `pnpm vitest run apps/site/src/components/home apps/site/src/pages/__tests__/home.test.tsx`
Expected: PASS (all kit and chapter tests green).

- [ ] **Step 6: Responsive + reduced-motion hand check**

Run: `pnpm --filter site dev` and open the home page. Verify at 360px, 768px, and a short-landscape phone (DevTools device toolbar):
- No horizontal page scroll at any width.
- Two-panel scenes (SSR, others) stack vertically below ~48rem; nothing clips.
- Pinned scenes fit the viewport (svh); the realtime chapter keeps moving without scrolling.
- Toggle "reduce motion" in DevTools rendering: scenes unpin to static frames, no scroll-jacking, all copy present.
- Tab through the routing explorer and CTAs: focus rings visible, targets >= 44px.

Record the result in the PR description. (No automated assertion; happy-dom cannot measure layout.)

- [ ] **Step 7: Full CI-parity gate (from `CLAUDE.md`), then commit**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format         # fix formatting first
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
git add apps/site/src/pages/home.tsx apps/site/src/pages/__tests__/home.test.tsx
git commit -m "feat(site): assemble the home scroll experience"
```

Expected: all eight steps pass. After opening the PR, read the `client-size` sticky comment and the `lighthouse` comment; if the home client-JS delta or LCP regressed meaningfully, note it and, if needed, split any heavy chapter behind an additional IntersectionObserver-gated dynamic import.

---

### Task 19 (optional): Konami-style easter egg

A personality flourish (spec section 3, marked optional). Implement only if the reviewer opted in; it is not required for the page to ship. Keep it accessibility-safe (keyboard-only, no motion dependence, respects reduced motion).

**Files:**
- Create: `apps/site/src/components/home/chapters/KonamiEgg.tsx`
- Test: `apps/site/src/components/home/chapters/__tests__/KonamiEgg.test.tsx`
- Modify: `apps/site/src/pages/home.tsx` (render `<KonamiEgg />` once, near the CTA)

**Interfaces:**
- Consumes: `preact/hooks` only.
- Produces: `export function KonamiEgg(): VNode`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/site/src/components/home/chapters/__tests__/KonamiEgg.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/preact';
import { KonamiEgg } from '../KonamiEgg.js';

afterEach(() => cleanup());

const SEQ = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
];

describe('KonamiEgg', () => {
  it('reveals the reward only after the full sequence', () => {
    render(<KonamiEgg />);
    expect(screen.queryByText(/use the platform/i)).toBeNull();
    for (const key of SEQ) fireEvent.keyDown(document, { key });
    expect(screen.getByText(/use the platform/i)).toBeInTheDocument();
  });

  it('resets on a wrong key', () => {
    render(<KonamiEgg />);
    for (const key of ['ArrowUp', 'ArrowUp', 'x']) fireEvent.keyDown(document, { key });
    for (const key of SEQ.slice(0, 3)) fireEvent.keyDown(document, { key });
    expect(screen.queryByText(/use the platform/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run apps/site/src/components/home/chapters/__tests__/KonamiEgg.test.tsx`
Expected: FAIL, cannot resolve `../KonamiEgg.js`.

- [ ] **Step 3: Write the component**

```tsx
// apps/site/src/components/home/chapters/KonamiEgg.tsx
import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

const SEQ = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
];

export function KonamiEgg(): VNode {
  const [won, setWon] = useState(false);
  const idx = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      idx.current = key === SEQ[idx.current] ? idx.current + 1 : key === SEQ[0] ? 1 : 0;
      if (idx.current === SEQ.length) {
        setWon(true);
        idx.current = 0;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  if (!won) return <span class="hx-egg" aria-hidden="true" />;
  return (
    <p class="hx-egg hx-egg--won" role="status">
      Nice. #useThePlatform, indeed.
    </p>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/site/src/components/home/chapters/__tests__/KonamiEgg.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/home/chapters/KonamiEgg.tsx apps/site/src/components/home/chapters/__tests__/KonamiEgg.test.tsx apps/site/src/pages/home.tsx
git commit -m "feat(site): optional konami easter egg"
```
