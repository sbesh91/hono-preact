import { describe, it, expect, afterEach } from 'vitest';
import {
  preloadLinkTags,
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
});

describe('preloadLinkTags', () => {
  it('renders one modulepreload <link> per url', () => {
    expect(preloadLinkTags(['/static/a.js', '/static/b.js'])).toEqual([
      '<link rel="modulepreload" href="/static/a.js" />',
      '<link rel="modulepreload" href="/static/b.js" />',
    ]);
  });

  it('returns [] for no urls', () => {
    expect(preloadLinkTags([])).toEqual([]);
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
});
