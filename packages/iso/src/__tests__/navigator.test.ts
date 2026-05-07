// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerRouteMode,
  lookupRouteMode,
  clearRegistry,
  setLatestFragment,
  subscribeToFragment,
  clearLatestFragment,
  installClickInterceptor,
  uninstallClickInterceptor,
  __setNavigateForTesting,
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

describe('navigator click interceptor', () => {
  let navigateSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    clearRegistry();
    navigateSpy = vi.fn();
    __setNavigateForTesting(navigateSpy);
    installClickInterceptor();
  });
  afterEach(() => {
    uninstallClickInterceptor();
    __setNavigateForTesting(null);
  });

  function clickAnchor(href: string, init?: Partial<MouseEventInit>): MouseEvent {
    const a = document.createElement('a');
    a.href = href;
    document.body.appendChild(a);
    const ev = new MouseEvent('click', {
      bubbles: true, cancelable: true, button: 0, ...init,
    });
    a.dispatchEvent(ev);
    a.remove();
    return ev;
  }

  it('intercepts SSR-route same-origin plain clicks', () => {
    registerRouteMode('/docs/:slug', 'ssr');
    const ev = clickAnchor(window.location.origin + '/docs/intro');
    expect(ev.defaultPrevented).toBe(true);
    expect(navigateSpy).toHaveBeenCalledWith('/docs/intro');
  });

  it('does not intercept SPA-route clicks', () => {
    const ev = clickAnchor(window.location.origin + '/profile');
    expect(ev.defaultPrevented).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does not intercept clicks with modifier keys', () => {
    registerRouteMode('/docs/:slug', 'ssr');
    const ev = clickAnchor(window.location.origin + '/docs/intro', { metaKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does not intercept cross-origin clicks', () => {
    registerRouteMode('/docs/:slug', 'ssr');
    const ev = clickAnchor('https://example.com/docs/intro');
    expect(ev.defaultPrevented).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does not intercept target=_blank', () => {
    registerRouteMode('/docs/:slug', 'ssr');
    const a = document.createElement('a');
    a.href = window.location.origin + '/docs/intro';
    a.target = '_blank';
    document.body.appendChild(a);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(ev);
    a.remove();
    expect(ev.defaultPrevented).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
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
