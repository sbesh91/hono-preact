import { describe, it, expect, afterEach } from 'vitest';
import { resolveAssetHints } from '../asset-hints.js';
import {
  installPreloadModules,
  __resetPreloadModulesForTests,
} from '../preload-modules.js';
import {
  installDevGlobalCss,
  __resetDevGlobalCssForTests,
} from '../dev-global-css.js';

afterEach(() => {
  __resetPreloadModulesForTests();
  __resetDevGlobalCssForTests();
});

describe('resolveAssetHints', () => {
  it('returns the entry closure as both head hints and Link header', async () => {
    installPreloadModules(() => ({
      closure: ['/static/a.js', '/static/b.js'],
      routes: {},
    }));

    const hints = await resolveAssetHints({
      requestUrl: 'https://example.test/',
    });

    expect(hints.preloadModules).toEqual(['/static/a.js', '/static/b.js']);
    expect(hints.linkHeader).toContain('</static/a.js>; rel=modulepreload');
    expect(hints.linkHeader).toContain('</static/b.js>; rel=modulepreload');
  });

  it('selects the matched route chunks and stylesheets for the request path', async () => {
    installPreloadModules(() => ({
      closure: [],
      routes: { '/docs/:slug': ['/static/docs.js'] },
      routeCss: { '/docs/:slug': ['/static/docs.css'] },
      globalCss: ['/static/global.css'],
    }));

    const hints = await resolveAssetHints({
      requestUrl: 'https://example.test/docs/intro',
    });

    expect(hints.routePreloadModules).toEqual(['/static/docs.js']);
    expect(hints.routeStyleSheets).toEqual(['/static/docs.css']);
    expect(hints.globalStyleSheets).toEqual(['/static/global.css']);
  });

  it('decodes the request path before matching build-time pattern keys', async () => {
    installPreloadModules(() => ({
      closure: [],
      routes: { '/docs/getting started': ['/static/gs.js'] },
    }));

    const hints = await resolveAssetHints({
      requestUrl: 'https://example.test/docs/getting%20started',
    });

    expect(hints.routePreloadModules).toEqual(['/static/gs.js']);
  });

  it('falls back to the raw path when the URL carries a malformed escape', async () => {
    installPreloadModules(() => ({
      closure: [],
      routes: { '/docs/%E0%A4%A': ['/static/raw.js'] },
    }));

    const hints = await resolveAssetHints({
      requestUrl: 'https://example.test/docs/%E0%A4%A',
    });

    expect(hints.routePreloadModules).toEqual(['/static/raw.js']);
  });

  it('drops artifact stylesheets entirely when the dev global CSS seam is installed', async () => {
    installPreloadModules(() => ({
      closure: [],
      routes: {},
      routeCss: { '/': ['/static/route.css'] },
      globalCss: ['/static/global.css'],
    }));
    installDevGlobalCss(['/src/global.css']);

    const hints = await resolveAssetHints({
      requestUrl: 'https://example.test/',
    });

    expect(hints.routeStyleSheets).toEqual([]);
    expect(hints.globalStyleSheets).toEqual(['/src/global.css']);
  });

  it('puts fonts ahead of the closure in the Link header', async () => {
    installPreloadModules(() => ({
      closure: ['/static/a.js'],
      routes: {},
    }));

    const hints = await resolveAssetHints({
      requestUrl: 'https://example.test/',
      fonts: ['/fonts/inter.woff2'],
    });

    expect(hints.linkHeader.indexOf('/fonts/inter.woff2')).toBeLessThan(
      hints.linkHeader.indexOf('/static/a.js')
    );
  });

  it('returns an empty Link header when there is nothing to hint', async () => {
    installPreloadModules(() => ({ closure: [], routes: {} }));

    const hints = await resolveAssetHints({
      requestUrl: 'https://example.test/',
    });

    expect(hints.linkHeader).toBe('');
  });
});
