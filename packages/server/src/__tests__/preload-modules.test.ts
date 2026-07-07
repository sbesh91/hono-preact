import { describe, it, expect, afterEach } from 'vitest';
import {
  preloadLinkHeader,
  installPreloadModules,
  resolvePreloadManifest,
  __resetPreloadModulesForTests,
} from '../preload-modules.js';

afterEach(() => __resetPreloadModulesForTests());

const EMPTY = { closure: [], routes: {} };

describe('installPreloadModules / resolvePreloadManifest', () => {
  it('resolves to an empty manifest when no reader is installed', async () => {
    expect(await resolvePreloadManifest()).toEqual(EMPTY);
  });

  it("resolves the reader's artifact (sync reader)", async () => {
    installPreloadModules(() => ({
      closure: ['/static/a.js', '/static/b.js'],
      routes: { '/': { high: [], low: ['/static/home.js'] } },
    }));
    expect(await resolvePreloadManifest()).toEqual({
      closure: ['/static/a.js', '/static/b.js'],
      routes: { '/': { high: [], low: ['/static/home.js'] } },
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
        '/ok': { high: ['/static/l.js'], low: ['/static/v.js', 7] },
        '/empty': { high: [], low: [] },
        '/bad': null,
      },
    }));
    expect(await resolvePreloadManifest()).toEqual({
      closure: ['/static/a.js'],
      routes: { '/ok': { high: ['/static/l.js'], low: ['/static/v.js'] } },
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
    });
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
});
