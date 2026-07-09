import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

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

/**
 * Reveal-on-scroll trigger. Returns a ref to attach to an element and a flag
 * that flips to true (once) when the element scrolls into view, so a group can
 * animate its children in on arrival rather than at mount. When motion is
 * disabled or IntersectionObserver is unavailable, it reports in-view
 * immediately so nothing is left hidden.
 */
export function useInView<T extends Element>({
  disabled = false,
  threshold = 0.18,
  rootMargin = '0px 0px -8% 0px',
}: {
  disabled?: boolean;
  threshold?: number;
  rootMargin?: string;
} = {}): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (disabled || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [disabled, threshold, rootMargin]);
  return [ref, inView];
}
