import { createContext } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { computeProgress, sliceProgress } from './progress.js';
import { usePrefersReducedMotion } from './motion.js';

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
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(fallbackProgress);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const tick = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const h = el.offsetHeight;
      const vh = window.innerHeight;
      setProgress(computeProgress(top, h, vh));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  if (reduced) {
    return (
      <div class="hx-stage hx-stage--static" ref={ref} aria-label={label}>
        <StageContext.Provider
          value={{ progress: fallbackProgress, pinned: false }}
        >
          {children}
        </StageContext.Provider>
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
      ref={ref}
      style={{
        '--stage-pages': pages,
        '--stage-pages-narrow': pagesNarrow ?? pages,
      }}
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
      value={{
        progress: sliceProgress(parent.progress, start, end),
        pinned: parent.pinned,
      }}
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
