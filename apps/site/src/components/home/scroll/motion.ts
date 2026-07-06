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
