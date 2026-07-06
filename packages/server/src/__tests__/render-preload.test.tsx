import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { JSX } from 'preact';
import { renderPage } from '../render.js';
import {
  installPreloadModules,
  __resetPreloadModulesForTests,
} from '../preload-modules.js';

function Page(): JSX.Element {
  return (
    <html>
      <head></head>
      <body>
        <div>hi</div>
      </body>
    </html>
  );
}

afterEach(() => __resetPreloadModulesForTests());

describe('renderPage — modulepreload closure', () => {
  it('injects modulepreload <link>s and a matching Link header from the installed closure', async () => {
    installPreloadModules(() => ['/static/a.js', '/static/b.js']);
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Page />));

    const res = await app.request('http://localhost/');
    const html = await res.text();

    expect(html).toContain('<link rel="modulepreload" href="/static/a.js" />');
    expect(html).toContain('<link rel="modulepreload" href="/static/b.js" />');
    expect(res.headers.get('Link')).toBe(
      '</static/a.js>; rel=modulepreload, </static/b.js>; rel=modulepreload'
    );
  });

  it('emits no hints and no Link header when no closure is installed', async () => {
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Page />));

    const res = await app.request('http://localhost/');
    const html = await res.text();

    expect(html).not.toContain('modulepreload');
    expect(res.headers.get('Link')).toBeNull();
  });
});
