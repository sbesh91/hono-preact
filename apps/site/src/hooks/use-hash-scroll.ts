import { useEffect } from 'preact/hooks';

// Scroll to the URL hash target after a soft (preact-iso) navigation, which
// does not scroll on its own. Re-runs on path change and on hashchange.
export function useHashScroll(path: string): void {
  useEffect(() => {
    scrollToHash();
    function onHashChange() {
      scrollToHash();
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [path]);
}

function scrollToHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const el = document.getElementById(decodeURIComponent(hash));
  if (!el) return;
  // Defer one frame so the destination page's content has committed.
  requestAnimationFrame(() =>
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  );
}
