import { createContext } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { computeProgress } from './progress.js';
import { usePrefersReducedMotion } from './motion.js';

/**
 * The one custom property every scroll-driven visual on this page reads. A stage
 * writes it on its own element each frame and it inherits to the whole scene, so
 * continuous motion (lane fills, the playhead, the morph, the drifting cursors)
 * is a pure CSS function of one number and costs no *render*. It still costs a
 * style recalc of the stage's subtree, which is the honest price of the design
 * (see the tick below). It is registered as a `<number>` in root.css (@property)
 * and seeded inline at SSR with the stage's fallback, so it always resolves:
 * no-JS and reduced-motion readers get the settled scene, not an unstyled one.
 */
const P = '--hx-p';

/** How the DOM sees the playhead: 4dp is finer than a device pixel at any size. */
const format = (progress: number): string => progress.toFixed(4);

/**
 * The playhead as a store rather than a render value. Calling `setProgress` on
 * every rAF tick used to push a fresh context value through the tree, which
 * force-updated every Lane and Region in the pinned chapter 60+ times a second
 * during momentum scroll. Subscribers now pull only the value they care about (see
 * `useStageValue`), so a threshold flip costs one render and a continuous value
 * costs none.
 */
export interface Playhead {
  get(): number;
  subscribe(listener: (progress: number) => void): () => void;
}

interface MutablePlayhead extends Playhead {
  /** True when the value changed (and listeners ran). */
  set(progress: number): boolean;
}

function createPlayhead(initial: number): MutablePlayhead {
  let current = initial;
  const listeners = new Set<(progress: number) => void>();
  return {
    get: () => current,
    /** Returns whether the value actually moved, so the caller can skip the DOM
     *  write too. Progress pins at exactly 0 and 1 for a stretch of scroll on
     *  either side of a stage (the IO keeps it active out to a 100px margin), so
     *  this is not a rare path. */
    set(progress) {
      if (progress === current) return false;
      current = progress;
      for (const listener of listeners) listener(progress);
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Hold one playhead for the life of the component (created once, never swapped). */
function usePlayhead(initial: number): MutablePlayhead {
  const ref = useRef<MutablePlayhead | null>(null);
  if (ref.current === null) ref.current = createPlayhead(initial);
  return ref.current;
}

export interface StageValue extends Playhead {
  pinned: boolean;
  /** True once client JS is actually driving the playhead. False in SSR and
   * when the bundle never runs, so progress-gated UI (Region skeletons) can
   * default to its resolved state instead of hiding content behind JS. */
  live: boolean;
}

const IDLE: StageValue = {
  get: () => 0,
  subscribe: () => () => {},
  pinned: false,
  live: false,
};

const StageContext = createContext<StageValue>(IDLE);

export function useStage(): StageValue {
  return useContext(StageContext);
}

/**
 * Read a *derived* slice of the playhead. The component re-renders only when the
 * selected value actually changes, so `p => p > 0.4` costs one render as the
 * reader crosses 0.4 and nothing across the rest of the scrub.
 *
 * `select` must return a primitive: values are compared with Object.is, so
 * returning a fresh object every frame would defeat the whole point. Anything
 * genuinely continuous belongs in CSS, derived from `--hx-p`, not here.
 */
export function useStageValue<T>(select: (progress: number) => T): T {
  const stage = useStage();
  // Read through a ref so an inline arrow (the common case at every call site)
  // doesn't resubscribe on every render.
  const selectRef = useRef(select);
  selectRef.current = select;
  const [value, setValue] = useState(() => select(stage.get()));
  useEffect(() => {
    const apply = (progress: number) => {
      const next = selectRef.current(progress);
      setValue((prev) => (Object.is(prev, next) ? prev : next));
    };
    // Catch up on mount: SSR rendered the fallback, the driver has since moved.
    apply(stage.get());
    return stage.subscribe(apply);
  }, [stage]);
  return value;
}

export function ScrollStage({
  pages,
  pagesNarrow,
  fallbackProgress = 0.5,
  label,
  children,
}: {
  pages: number;
  pagesNarrow?: number;
  fallbackProgress?: number;
  label?: string;
  children: ComponentChildren;
}): VNode {
  const reduced = usePrefersReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const playhead = usePlayhead(fallbackProgress);

  useEffect(() => {
    if (reduced) return;
    const stage = stageRef.current;
    const pin = pinRef.current;
    if (!stage || !pin) return;
    setLive(true);
    let raf = 0;
    let active = false;
    // Cached geometry so the per-frame tick reads only window.scrollY, never
    // layout. Reading getBoundingClientRect/offsetHeight inside the scroll
    // handler forces a synchronous reflow every frame, which is a major stutter
    // source on iOS Safari during momentum scrolling. Refreshed only when the
    // stage enters view and on resize, which is when its position can change.
    let docTop = 0;
    let height = 0;
    let pinHeight = 0;
    const measure = () => {
      docTop = stage.getBoundingClientRect().top + window.scrollY;
      height = stage.offsetHeight;
      // The pin, not the window (see computeProgress). The pin is the 100svh box
      // the scrub actually runs against, and measuring it is what keeps the
      // playhead honest when a mobile URL bar collapses mid-scroll.
      pinHeight = pin.offsetHeight;
    };
    const tick = () => {
      raf = 0;
      const progress = computeProgress(
        docTop - window.scrollY,
        height,
        pinHeight
      );
      // Publish once, to one node. Every continuous visual in the scene is a CSS
      // function of this, and discrete consumers (a status chip, a pane swap)
      // hear about it only when their own derived value actually changed.
      //
      // Honest accounting: this is not free, it is *cheap*. Writing an inherited
      // custom property invalidates style for the pin's subtree, so the frame
      // still costs a style recalc; what it no longer costs is a Preact render
      // and a VDOM diff of every Lane and Region in the chapter. And a transform
      // built from var()/calc() is resolved on the main thread during that
      // recalc -- only the resulting matrix reaches the compositor. The genuinely
      // off-main-thread version is `animation-timeline`, which is not Baseline
      // Widely Available and could not drive the discrete JS state anyway.
      if (playhead.set(progress)) pin.style.setProperty(P, format(progress));
    };
    const onScroll = () => {
      if (active && !raf) raf = requestAnimationFrame(tick);
    };
    // Only stages in (or near) the viewport run the scroll math; the rest stay
    // idle instead of computing and re-rendering to a clamped 0/1 every frame.
    // Without IntersectionObserver (legacy WebViews), drive unconditionally
    // instead of throwing, mirroring the graceful fallback in useInView.
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'undefined') {
      active = true;
      stage.toggleAttribute('data-active', true);
      measure();
      tick();
    } else {
      io = new IntersectionObserver(
        ([entry]) => {
          active = entry.isIntersecting;
          // CSS keys `will-change` off this, so the scrub-driven layers are
          // promoted only while their chapter is on screen. A standing hint would
          // hold a compositor layer per element for the life of the page to serve
          // motion that only ever runs in one chapter at a time.
          stage.toggleAttribute('data-active', active);
          if (active) {
            measure();
            tick();
          } else if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
          }
        },
        { rootMargin: '100px' }
      );
      io.observe(stage);
    }
    const onResize = () => {
      if (!active) return;
      measure();
      onScroll();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      io?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced, playhead]);

  const value = useMemo<StageValue>(
    () => ({
      // The static branch is frozen at `fallbackProgress`, and its JS half has to
      // be frozen at the same number as its CSS half. `reduced` is a live media
      // query, so it can flip mid-session: a reader scrolled to 0.33 who switches
      // on Reduce Motion gets `--hx-p: 0.9` inline (the fallback) while the
      // playhead object still holds 0.33. Handing that object straight through
      // would split the scene down the middle, CSS rendering the settled morph
      // while JS still reports it closed and captions it "scroll to morph".
      get: reduced ? () => fallbackProgress : playhead.get,
      subscribe: playhead.subscribe,
      pinned: !reduced,
      // Same flip, same reason. `reduced` starts false so the first client render
      // matches SSR, so a reduced-motion reader mounts the live stage for one
      // frame before flipping. Nothing drives the playhead in the static branch,
      // so a stale `live: true` would leave every Region waiting on a threshold
      // that can never arrive, stranding the reader on a skeleton.
      live: live && !reduced,
    }),
    [playhead, reduced, live, fallbackProgress]
  );

  if (reduced) {
    return (
      <div
        class="hx-stage hx-stage--static"
        ref={stageRef}
        aria-label={label}
        style={{ [P]: fallbackProgress }}
      >
        <StageContext.Provider value={value}>{children}</StageContext.Provider>
      </div>
    );
  }
  // The demo pins on every width (mobile scrubs the same sticky pin as desktop).
  // Pin height is CSS-driven (--stage-pages, narrowed by a media query) rather
  // than a JS page count keyed off a viewport probe, so the server and client
  // agree at first paint: a phone gets the narrow height immediately instead of
  // rendering the desktop height and shrinking after hydration (layout shift).
  return (
    <div
      class="hx-stage"
      ref={stageRef}
      style={{
        '--stage-pages': pages,
        '--stage-pages-narrow': pagesNarrow ?? pages,
      }}
      aria-label={label}
    >
      {/* --hx-p is seeded with the fallback so the SSR'd scene is the settled
          one; the effect above overwrites it on this node every frame. */}
      <div class="hx-stage__pin" ref={pinRef} style={{ [P]: fallbackProgress }}>
        <StageContext.Provider value={value}>{children}</StageContext.Provider>
      </div>
    </div>
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
  const playhead = usePlayhead(fallbackProgress);

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let running = false;
    const loop = (ts: number) => {
      if (!running) return;
      const progress = (ts % periodMs) / periodMs;
      if (playhead.set(progress)) el.style.setProperty(P, format(progress));
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    // Gate the clock on visibility with IntersectionObserver instead of a
    // per-frame getBoundingClientRect (a forced layout read every frame for
    // the component's whole lifetime, even far off-screen). Without IO, run
    // unconditionally, mirroring ScrollStage's fallback.
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'undefined') {
      el.toggleAttribute('data-active', true);
      start();
    } else {
      io = new IntersectionObserver(([entry]) => {
        // Same as ScrollStage: the peers' layers are promoted only while the room
        // is on screen, which is also the only time their clock runs.
        el.toggleAttribute('data-active', entry.isIntersecting);
        if (entry.isIntersecting) start();
        else stop();
      });
      io.observe(el);
    }
    return () => {
      io?.disconnect();
      stop();
    };
  }, [reduced, periodMs, playhead]);

  const value = useMemo<StageValue>(
    () => ({
      get: playhead.get,
      subscribe: playhead.subscribe,
      pinned: false,
      // Unconditionally live: without JS the fallbackProgress renders the room
      // fully-on, which is the right static state, and no Region hangs off a
      // LiveStage.
      live: true,
    }),
    [playhead]
  );

  return (
    <div class="hx-live" ref={ref} style={{ [P]: fallbackProgress }}>
      <StageContext.Provider value={value}>{children}</StageContext.Provider>
    </div>
  );
}
