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
  navigate,
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
    __setNavigateForTesting(navigateSpy as unknown as (url: string) => void);
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

  it('does not push history state on click-intercepted navigation (preact-iso handles it)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        events: [{ type: 'envelope', html: '<p>x</p>', head: {} }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    const pushSpy = vi.spyOn(history, 'pushState');
    registerRouteMode('/docs/:slug', 'ssr');

    // Simulate click via the real interceptor (drop testingNavigate so the real navigate runs).
    __setNavigateForTesting(null);
    const a = document.createElement('a');
    a.href = window.location.origin + '/docs/intro';
    document.body.appendChild(a);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(ev);
    a.remove();

    // Wait for the navigate promise to settle.
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
    pushSpy.mockRestore();
    // Restore testingNavigate so afterEach works cleanly.
    __setNavigateForTesting(navigateSpy as unknown as (url: string) => void);
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

describe('navigator.navigate()', () => {
  const ORIGINAL_LOCATION = window.location;
  beforeEach(() => {
    clearRegistry();
    clearLatestFragment();
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: ORIGINAL_LOCATION, writable: true });
  });

  it('fetches URL with X-HP-Navigate: fragment and applies envelope', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        events: [{
          type: 'envelope',
          html: '<section id="loader-foo" data-loader="{}">x</section>',
          head: { title: 'Doc' },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    registerRouteMode('/docs/:slug', 'ssr');

    const seen: string[] = [];
    subscribeToFragment('/docs/:slug', (h) => seen.push(h));

    await navigate('/docs/intro');

    expect(fetchSpy).toHaveBeenCalledWith('/docs/intro', expect.objectContaining({
      headers: expect.objectContaining({ 'X-HP-Navigate': 'fragment' }),
    }));
    expect(seen).toEqual(['<section id="loader-foo" data-loader="{}">x</section>']);
    expect(document.title).toBe('Doc');

    fetchSpy.mockRestore();
  });

  it('falls back to location.assign on non-2xx response', async () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignSpy, origin: window.location.origin },
      writable: true,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 })
    );
    registerRouteMode('/docs/*', 'ssr');
    await navigate('/docs/x');
    expect(assignSpy).toHaveBeenCalledWith('/docs/x');
    vi.restoreAllMocks();
  });

  it('follows redirect events to a new navigate call', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({
          events: [{ type: 'redirect', location: '/login' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        events: [{ type: 'envelope', html: '<p>login</p>', head: { title: 'Login' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    registerRouteMode('/docs/:slug', 'ssr');
    registerRouteMode('/login', 'ssr');
    const seen: string[] = [];
    subscribeToFragment('/login', (h) => seen.push(h));
    await navigate('/docs/secret');
    expect(calls).toBe(2);
    expect(seen).toEqual(['<p>login</p>']);
    vi.restoreAllMocks();
  });
});

describe('navigator popstate handling', () => {
  const ORIGINAL_LOCATION = window.location;
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: ORIGINAL_LOCATION, writable: true });
  });

  it('refetches the fragment on popstate for SSR routes without pushing state', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        events: [{ type: 'envelope', html: '<p>back</p>', head: {} }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    const pushSpy = vi.spyOn(history, 'pushState');
    registerRouteMode('/docs/*', 'ssr');
    const seen: string[] = [];
    subscribeToFragment('/docs/*', (h) => seen.push(h));

    // Simulate browser back/forward to /docs/old.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/docs/old', search: '' },
      writable: true,
    });
    window.dispatchEvent(new PopStateEvent('popstate'));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalledWith('/docs/old', expect.anything());
    expect(pushSpy).not.toHaveBeenCalled();
    expect(seen).toEqual(['<p>back</p>']);

    fetchSpy.mockRestore();
    pushSpy.mockRestore();
  });
});
