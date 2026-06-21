import { useEffect } from 'preact/hooks';

// Scroll to the URL hash target after a soft (preact-iso) navigation, which does
// not scroll on its own. Re-runs on path change and on hashchange.
//
// On a cold navigation to a code-split page the target heading is not in the DOM
// yet when this first runs (the lazy route chunk is still loading). Rather than
// poll every frame, wait for it with a MutationObserver: it fires only when the
// DOM actually changes, scrolls once, then disconnects. A deadline stops the
// wait for a hash that never resolves. Warm pages scroll immediately.
export function useHashScroll(path: string): void {
  useEffect(() => {
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stopWaiting = () => {
      observer?.disconnect();
      observer = null;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const scrollToHash = () => {
      stopWaiting();
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const id = decodeURIComponent(hash);

      const tryScroll = (): boolean => {
        const el = document.getElementById(id);
        if (!el) return false;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      };

      // Warm page: the target is already here.
      if (tryScroll()) return;

      // Cold page: wait for the lazy content to mount, scroll once, give up
      // after the deadline if it never appears.
      if (typeof MutationObserver === 'undefined') return;
      observer = new MutationObserver(() => {
        if (tryScroll()) stopWaiting();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timer = setTimeout(stopWaiting, 3000);
    };

    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);
    return () => {
      stopWaiting();
      window.removeEventListener('hashchange', scrollToHash);
    };
  }, [path]);
}
