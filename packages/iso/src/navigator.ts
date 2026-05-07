import { exec } from 'preact-iso';

export type NavigateMode = 'spa' | 'ssr';

const routeModes = new Map<string, NavigateMode>();
const subscribers = new Map<string, Set<(html: string) => void>>();
const latestFragments = new Map<string, string>();

export function registerRouteMode(path: string, mode: NavigateMode): void {
  routeModes.set(path, mode);
  if (mode === 'ssr') installClickInterceptor();
}

export function clearRegistry(): void {
  routeModes.clear();
}

/**
 * Look up the navigate mode for a URL by matching against registered paths.
 * Defaults to 'spa' when no registered path matches.
 */
export function lookupRouteMode(url: string): NavigateMode {
  for (const [pattern, mode] of routeModes) {
    if (exec(url, pattern, {})) return mode;
  }
  return 'spa';
}

export function setLatestFragment(path: string, html: string): void {
  latestFragments.set(path, html);
  const subs = subscribers.get(path);
  if (subs) for (const fn of subs) fn(html);
}

export function clearLatestFragment(): void {
  latestFragments.clear();
}

export function subscribeToFragment(
  path: string,
  handler: (html: string) => void
): () => void {
  let set = subscribers.get(path);
  if (!set) {
    set = new Set();
    subscribers.set(path, set);
  }
  set.add(handler);
  // Replay latest fragment if one is buffered.
  const latest = latestFragments.get(path);
  if (latest !== undefined) handler(latest);
  return () => {
    const s = subscribers.get(path);
    if (s) {
      s.delete(handler);
      if (s.size === 0) subscribers.delete(path);
    }
  };
}

// Implemented in Task 7. Stub is intentionally loud to surface accidental misuse.
export function navigate(url: string): void {
  throw new Error(`navigator.navigate() not yet implemented (url: ${url})`);
}

let installed = false;
let testingNavigate: ((url: string) => void) | null = null;

export function __setNavigateForTesting(fn: ((url: string) => void) | null): void {
  testingNavigate = fn;
}

function dispatchNavigate(url: string): void {
  if (testingNavigate) testingNavigate(url);
  else navigate(url);
}

function shouldInterceptClick(event: MouseEvent): { url: string } | null {
  if (event.defaultPrevented) return null;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (event.button !== 0) return null;
  const target = event.composedPath().find(
    (el): el is HTMLAnchorElement =>
      el instanceof HTMLAnchorElement && !!el.href
  );
  if (!target) return null;
  if (target.origin !== location.origin) return null;
  if (target.hasAttribute('download')) return null;
  if (target.target && !/^_?self$/i.test(target.target)) return null;
  const href = target.getAttribute('href');
  if (!href || /^#/.test(href)) return null;
  return { url: target.href.replace(location.origin, '') };
}

function onClickCapture(event: MouseEvent): void {
  const decision = shouldInterceptClick(event);
  if (!decision) return;
  if (lookupRouteMode(decision.url) !== 'ssr') return;
  event.preventDefault();
  dispatchNavigate(decision.url);
}

export function installClickInterceptor(): void {
  if (installed) return;
  if (typeof document === 'undefined') return;
  document.addEventListener('click', onClickCapture, true);
  installed = true;
}

export function uninstallClickInterceptor(): void {
  if (!installed) return;
  document.removeEventListener('click', onClickCapture, true);
  installed = false;
}
