import { useEffect } from 'preact/hooks';

// Scroll to the URL hash target after a soft (preact-iso) navigation, which does
// not scroll on its own. Re-runs on path change and on hashchange.
//
// On a cold navigation to a code-split page, the target heading is not in the
// DOM yet when this first runs (the lazy route chunk is still loading), so a
// single rAF misses it. Poll across frames until the element mounts, with a
// deadline so a bad/absent hash gives up cleanly. Warm pages resolve on the
// first frame.
export function useHashScroll(path: string): void {
  useEffect(() => {
    let raf = 0;
    let cancelled = false;

    const scrollToHash = () => {
      cancelAnimationFrame(raf);
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const id = decodeURIComponent(hash);
      const deadline = Date.now() + 3000;

      const attempt = () => {
        if (cancelled) return;
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (Date.now() < deadline) {
          raf = requestAnimationFrame(attempt);
        }
      };
      raf = requestAnimationFrame(attempt);
    };

    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('hashchange', scrollToHash);
    };
  }, [path]);
}
