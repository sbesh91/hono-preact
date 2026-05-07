import { exec } from 'preact-iso';

export type NavigateMode = 'spa' | 'ssr';

const routeModes = new Map<string, NavigateMode>();
const subscribers = new Map<string, Set<(html: string) => void>>();
const latestFragments = new Map<string, string>();

export function registerRouteMode(path: string, mode: NavigateMode): void {
  routeModes.set(path, mode);
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
