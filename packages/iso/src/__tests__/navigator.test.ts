// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerRouteMode,
  lookupRouteMode,
  clearRegistry,
  setLatestFragment,
  subscribeToFragment,
  clearLatestFragment,
} from '../navigator.js';

beforeEach(() => {
  clearRegistry();
  clearLatestFragment();
});

describe('navigator route mode registry', () => {
  it('returns "spa" for unregistered paths', () => {
    expect(lookupRouteMode('/anything')).toBe('spa');
  });

  it('returns "ssr" for an exact registered path', () => {
    registerRouteMode('/docs', 'ssr');
    expect(lookupRouteMode('/docs')).toBe('ssr');
  });

  it('matches preact-iso path patterns with parameters', () => {
    registerRouteMode('/docs/:slug', 'ssr');
    expect(lookupRouteMode('/docs/intro')).toBe('ssr');
    expect(lookupRouteMode('/blog/x')).toBe('spa');
  });

  it('matches /docs/* rest patterns', () => {
    registerRouteMode('/docs/*', 'ssr');
    expect(lookupRouteMode('/docs/a')).toBe('ssr');
    expect(lookupRouteMode('/docs/a/b/c')).toBe('ssr');
  });
});

describe('navigator fragment buffer + subscription', () => {
  it('delivers the latest fragment to a new subscriber for that path', () => {
    setLatestFragment('/docs/*', '<section>hi</section>');
    let received: string | null = null;
    const unsub = subscribeToFragment('/docs/*', (html) => { received = html; });
    expect(received).toBe('<section>hi</section>');
    unsub();
  });

  it('notifies all current subscribers when a new fragment arrives', () => {
    const seen: string[] = [];
    const unsub = subscribeToFragment('/docs/*', (html) => seen.push(html));
    setLatestFragment('/docs/*', 'A');
    setLatestFragment('/docs/*', 'B');
    expect(seen).toEqual(['A', 'B']);
    unsub();
  });

  it('does not deliver fragments for other paths', () => {
    const seen: string[] = [];
    const unsub = subscribeToFragment('/docs/*', (h) => seen.push(h));
    setLatestFragment('/blog/*', 'X');
    expect(seen).toEqual([]);
    unsub();
  });
});
