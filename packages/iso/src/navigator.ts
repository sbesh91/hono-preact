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

let inflight: AbortController | null = null;

type Envelope = {
  type: 'envelope';
  html: string;
  head: {
    title?: string;
    metas?: { name?: string; content?: string; property?: string }[];
    links?: { rel?: string; href?: string }[];
  };
};
type Redirect = { type: 'redirect'; location: string };
type Fallback = { type: 'fallback' };
type EventItem = Envelope | Redirect | Fallback;

function applyHead(head: Envelope['head']): void {
  if (typeof document === 'undefined') return;
  if (head.title !== undefined) document.title = head.title;
  // For metas/links: imperatively reconcile with hoofd-rendered tags.
  // v1 keeps this minimal; hoofd hooks in the hydrating tree will further
  // reconcile after hydrate fires. See spec "Hoofd reconciliation" risk note.
}

export function findMatchingPattern(url: string): string | null {
  for (const [pattern] of routeModes) {
    if (exec(url, pattern, {})) return pattern;
  }
  return null;
}

let testingNavigate: ((url: string) => void) | null = null;

export function __setNavigateForTesting(fn: ((url: string) => void) | null): void {
  testingNavigate = fn;
}

export async function navigate(
  url: string,
  opts: { push?: boolean } = { push: true }
): Promise<void> {
  if (testingNavigate) return testingNavigate(url) as unknown as void;
  if (inflight) inflight.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'X-HP-Navigate': 'fragment' },
      signal: ctrl.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    location.assign(url);
    return;
  }
  if (!res.ok) {
    location.assign(url);
    return;
  }
  let body: { events?: EventItem[] };
  try {
    body = await res.json();
  } catch {
    location.assign(url);
    return;
  }
  const events = body.events ?? [];
  for (const event of events) {
    if (event.type === 'envelope') {
      applyHead(event.head);
      const pattern = findMatchingPattern(url);
      if (pattern) setLatestFragment(pattern, event.html);
      // History update: gated by opts.push so popstate-triggered fetches
      // don't double-push.
      if (opts.push) history.pushState(null, '', url);
    } else if (event.type === 'redirect') {
      await navigate(event.location);
      return;
    } else if (event.type === 'fallback') {
      location.assign(url);
      return;
    }
  }
}

function dispatchNavigate(url: string): void {
  if (testingNavigate) testingNavigate(url);
  else void navigate(url);
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

function onPopstate(): void {
  const url = location.pathname + location.search;
  if (lookupRouteMode(url) === 'ssr') {
    void navigate(url, { push: false });
  }
}

let installed = false;

export function installClickInterceptor(): void {
  if (installed) return;
  if (typeof document === 'undefined') return;
  document.addEventListener('click', onClickCapture, true);
  window.addEventListener('popstate', onPopstate);
  installed = true;
}

export function uninstallClickInterceptor(): void {
  if (!installed) return;
  document.removeEventListener('click', onClickCapture, true);
  window.removeEventListener('popstate', onPopstate);
  installed = false;
}
