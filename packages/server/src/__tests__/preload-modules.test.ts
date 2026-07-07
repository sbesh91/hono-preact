import { describe, it, expect, afterEach } from 'vitest';
import {
  preloadLinkHeader,
  installPreloadModules,
  resolvePreloadModules,
  __resetPreloadModulesForTests,
} from '../preload-modules.js';

afterEach(() => __resetPreloadModulesForTests());

describe('installPreloadModules / resolvePreloadModules', () => {
  it('resolves to [] when no reader is installed', async () => {
    expect(await resolvePreloadModules()).toEqual([]);
  });

  it("resolves to the reader's list (sync reader)", async () => {
    installPreloadModules(() => ['/static/a.js', '/static/b.js']);
    expect(await resolvePreloadModules()).toEqual([
      '/static/a.js',
      '/static/b.js',
    ]);
  });

  it('awaits an async reader', async () => {
    installPreloadModules(async () => ['/static/a.js']);
    expect(await resolvePreloadModules()).toEqual(['/static/a.js']);
  });

  it('memoizes: the reader runs once across many resolves', async () => {
    let calls = 0;
    installPreloadModules(() => {
      calls++;
      return ['/static/a.js'];
    });
    await Promise.all([
      resolvePreloadModules(),
      resolvePreloadModules(),
      resolvePreloadModules(),
    ]);
    await resolvePreloadModules();
    expect(calls).toBe(1);
  });

  it('degrades to [] (never throws) when the reader returns a non-array', async () => {
    // A corrupt/partial artifact can JSON.parse to a non-array; the resolver
    // must not let that spread-throw and poison every later render.
    installPreloadModules(() => ({}) as unknown as string[]);
    expect(await resolvePreloadModules()).toEqual([]);
  });

  it('drops non-string entries from the reader result', async () => {
    installPreloadModules(
      () => ['/static/a.js', 42, null] as unknown as string[]
    );
    expect(await resolvePreloadModules()).toEqual(['/static/a.js']);
  });

  it('does not poison the memo: a rejecting read degrades to [] and retries next call', async () => {
    let attempt = 0;
    installPreloadModules(() => {
      attempt++;
      if (attempt === 1) return Promise.reject(new Error('transient'));
      return ['/static/a.js'];
    });
    // First call sees the failure and degrades, without throwing.
    expect(await resolvePreloadModules()).toEqual([]);
    // A failed read is not memoized, so the next request retries and succeeds.
    expect(await resolvePreloadModules()).toEqual(['/static/a.js']);
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
