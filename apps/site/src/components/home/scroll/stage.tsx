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
