import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  preloadLinkHeader,
  installPreloadModules,
  resolvePreloadManifest,
  __resetPreloadModulesForTests,
} from '../preload-modules.js';
import {
  installDevGlobalCss,
  getDevGlobalCss,
  __resetDevGlobalCssForTests,
} from '../dev-global-css.js';

afterEach(() => __resetPreloadModulesForTests());

const EMPTY = { closure: [], routes: {}, routeCss: {}, globalCss: [] };

describe('installPreloadModules / resolvePreloadManifest', () => {
  it('resolves to an empty manifest when no reader is installed', async () => {
    expect(await resolvePreloadManifest()).toEqual(EMPTY);
  });

  it("resolves the reader's artifact (sync reader)", async () => {
    installPreloadModules(() => ({
      closure: ['/static/a.js', '/static/b.js'],
      routes: { '/': ['/static/home.js'] },
    }));
    expect(await resolvePreloadManifest()).toEqual({
      closure: ['/static/a.js', '/static/b.js'],
      routes: { '/': ['/static/home.js'] },
      routeCss: {},
      globalCss: [],
    });
  });

  it('awaits an async reader', async () => {
    installPreloadModules(async () => ({
      closure: ['/static/a.js'],
      routes: {},
    }));
    expect(await resolvePreloadManifest()).toEqual({
      closure: ['/static/a.js'],
      routes: {},
      routeCss: {},
      globalCss: [],
    });
  });

  it('memoizes: the reader runs once across many resolves', async () => {
    let calls = 0;
    installPreloadModules(() => {
      calls++;
      return { closure: ['/static/a.js'], routes: {} };
    });
    await Promise.all([
      resolvePreloadManifest(),
      resolvePreloadManifest(),
      resolvePreloadManifest(),
    ]);
    await resolvePreloadManifest();
    expect(calls).toBe(1);
  });

  it('degrades to an empty manifest (never throws) on a non-object artifact', async () => {
    // A corrupt/partial artifact can JSON.parse to a non-object; the resolver
    // must not let that spread-throw and poison every later render.
    installPreloadModules(() => 42);
    expect(await resolvePreloadManifest()).toEqual(EMPTY);
  });

  it('defaults missing parts and drops malformed entries', async () => {
    installPreloadModules(() => ({
      closure: ['/static/a.js', 42, null],
      routes: {
        '/ok': ['/static/l.js', '/static/v.js', 7],
        '/empty': [],
        '/bad': null,
      },
    }));
    expect(await resolvePreloadManifest()).toEqual({
      closure: ['/static/a.js'],
      routes: { '/ok': ['/static/l.js', '/static/v.js'] },
      routeCss: {},
      globalCss: [],
    });
  });

  it('normalizes routeCss and drops malformed entries, like routes', async () => {
    installPreloadModules(() => ({
      closure: [],
      routes: {},
      routeCss: {
        '/': ['/static/home.css', 9],
        '/empty': [],
        '/bad': null,
      },
    }));
    expect(await resolvePreloadManifest()).toEqual({
      closure: [],
      routes: {},
      routeCss: { '/': ['/static/home.css'] },
      globalCss: [],
    });
  });

  it('does not poison the memo: a rejecting read degrades then retries next call', async () => {
    let attempt = 0;
    installPreloadModules(() => {
      attempt++;
      if (attempt === 1) return Promise.reject(new Error('transient'));
      return { closure: ['/static/a.js'], routes: {} };
    });
    // First call sees the failure and degrades, without throwing.
    expect(await resolvePreloadManifest()).toEqual(EMPTY);
    // A failed read is not memoized, so the next request retries and succeeds.
    expect(await resolvePreloadManifest()).toEqual({
      closure: ['/static/a.js'],
      routes: {},
      routeCss: {},
      globalCss: [],
    });
  });

  it('warns when the reader rejects (the manifest now carries render-critical CSS)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      installPreloadModules(() => Promise.reject(new Error('boom')));
      expect(await resolvePreloadManifest()).toEqual(EMPTY);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain('preload manifest read failed');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('preloadLinkHeader', () => {
  it('joins urls as an RFC 8288 Link header value with rel=modulepreload', () => {
    expect(preloadLinkHeader(['/static/a.js', '/static/b.js'])).toBe(
      '</static/a.js>; rel=modulepreload, </static/b.js>; rel=modulepreload'
    );
  });

  it('returns undefined for no urls (so no empty header is set)', () => {
    expect(preloadLinkHeader([])).toBeUndefined();
  });

  it('caps the header near the CDN header-size limit, keeping the prefix that fits', () => {
    const urls = Array.from(
      { length: 2000 },
      (_, i) => `/static/chunk-${i}-abcdefgh.js`
    );
    const header = preloadLinkHeader(urls)!;
    expect(header.length).toBeLessThanOrEqual(12_000);
    // Truncated: fewer entries than the input, and each kept entry is intact.
    const entries = header.split(', ');
    expect(entries.length).toBeLessThan(urls.length);
    expect(entries[0]).toBe('</static/chunk-0-abcdefgh.js>; rel=modulepreload');
  });

  it('shrinks the truncation budget by usedBytes, so a header combined with an earlier part stays within the overall cap', () => {
    const urls = Array.from(
      { length: 2000 },
      (_, i) => `/static/chunk-${i}-abcdefgh.js`
    );
    const header = preloadLinkHeader(urls, 11_900)!;
    // 11_900 bytes were already used by an earlier part of the combined header
    // (e.g. font preloads); the closure portion must fit in what remains.
    expect(header.length).toBeLessThanOrEqual(100);
  });

  it('returns undefined when usedBytes already exhausts the budget', () => {
    const urls = ['/static/a.js', '/static/b.js'];
    expect(preloadLinkHeader(urls, 12_000)).toBeUndefined();
  });
});

describe('manifest globalCss', () => {
  it('normalizes globalCss and defaults it to empty', async () => {
    __resetPreloadModulesForTests();
    installPreloadModules(() => ({ globalCss: ['/static/global-a.css', 7] }));
    const m = await resolvePreloadManifest();
    expect(m.globalCss).toEqual(['/static/global-a.css']);
    __resetPreloadModulesForTests();
    const empty = await resolvePreloadManifest();
    expect(empty.globalCss).toEqual([]);
  });
});

describe('dev global css seam', () => {
  it('round-trips installed dev urls and resets', () => {
    __resetDevGlobalCssForTests();
    expect(getDevGlobalCss()).toBeUndefined();
    installDevGlobalCss(['/src/styles/root.css']);
    expect(getDevGlobalCss()).toEqual(['/src/styles/root.css']);
    __resetDevGlobalCssForTests();
    expect(getDevGlobalCss()).toBeUndefined();
  });
});
