import { describe, it, expect, vi } from 'vitest';
import {
  findApiShadowingRoutes,
  hasDefaultExport,
} from '../ast-diagnostics.js';

describe('findApiShadowingRoutes', () => {
  it('flags literal "*" on any HTTP method as an error', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().get('*', (c) => c.text('catch'));
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'wildcard',
      method: 'get',
      pattern: '*',
      severity: 'error',
    });
  });

  it('flags literal "/*" as an error', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().all('/*', (c) => c.text('catch'));
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'wildcard',
      method: 'all',
      pattern: '/*',
      severity: 'error',
    });
  });

  it('flags an app.on() catch-all (path is the second argument)', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().on('GET', '*', (c) => c.text('catch'));
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'wildcard',
      method: 'on',
      pattern: '*',
      severity: 'error',
    });
  });

  it('flags a literal /__loaders registration as a reserved-path error', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().get('/__loaders', (c) => c.text('mine'));
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'reserved',
      method: 'get',
      pattern: '/__loaders',
      severity: 'error',
    });
  });

  it('flags an app.on() registration of a reserved path (path is the second argument)', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().on('GET', '/__loaders', (c) => c.text('mine'));
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'reserved',
      method: 'on',
      pattern: '/__loaders',
      severity: 'error',
    });
  });

  it('flags app.notFound(...) as a warning, not an error', () => {
    const src = `
      import { Hono } from 'hono';
      const app = new Hono();
      app.notFound((c) => c.text('nope', 404));
      export default app;
    `;
    const found = findApiShadowingRoutes(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'notFound', severity: 'warning' });
  });

  it('does not flag variable-arg routes', () => {
    const src = `
      import { Hono } from 'hono';
      const path = '/api/foo';
      export default new Hono().get(path, (c) => c.text('ok'));
    `;
    expect(findApiShadowingRoutes(src)).toEqual([]);
  });

  it('does not flag pathless app.use(...) middleware', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().use((c, next) => next());
    `;
    expect(findApiShadowingRoutes(src)).toEqual([]);
  });

  it('does not flag a specific path on a chained call', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono()
        .get('/api/watched/:id/photo', (c) => c.text('ok'))
        .post('/api/watched', (c) => c.text('ok'));
    `;
    expect(findApiShadowingRoutes(src)).toEqual([]);
  });

  it('returns multiple entries if multiple shadowing routes are present', () => {
    const src = `
      import { Hono } from 'hono';
      const app = new Hono();
      app.get('*', (c) => c.text('a'));
      app.notFound((c) => c.text('b'));
      export default app;
    `;
    expect(findApiShadowingRoutes(src)).toHaveLength(2);
  });

  it('does not flag c.notFound() inside a handler body', () => {
    const src = `
      import { Hono } from 'hono';
      export default new Hono().get('/api/x/:id', (c) => {
        const id = Number(c.req.param('id'));
        if (!Number.isFinite(id)) return c.notFound();
        return c.text('ok');
      });
    `;
    expect(findApiShadowingRoutes(src)).toEqual([]);
  });
});

describe('hasDefaultExport', () => {
  it('accepts the correct app-config spelling', () => {
    expect(hasDefaultExport(`export default defineApp({ use: [] });`)).toBe(
      true
    );
  });

  it('accepts a default export of a previously declared binding', () => {
    const src = `
      const appConfig = defineApp({ use: [] });
      export default appConfig;
    `;
    expect(hasDefaultExport(src)).toBe(true);
  });

  it('rejects the named-export mistake the diagnostic exists to catch', () => {
    expect(
      hasDefaultExport(`export const appConfig = defineApp({ use: [] });`)
    ).toBe(false);
  });

  it('does not count a default export nested inside another module construct', () => {
    // `export default` is only legal at the top level, so anything that merely
    // contains the substring must not satisfy the check.
    expect(hasDefaultExport(`const s = "export default defineApp({})";`)).toBe(
      false
    );
  });

  it('fails closed on an unparseable file so it cannot pile onto a syntax error', () => {
    // Deliberately unrecoverable: reporting "no default export" here would
    // bury the real syntax error the Vite build is about to surface.
    expect(hasDefaultExport(`const ={{{ !!! function )(`)).toBe(true);
  });
});

describe('findApiShadowingRoutes: parse failure', () => {
  it('fails open with a note that carries the parser message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(findApiShadowingRoutes(`const ={{{ !!! function )(`)).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0]?.[0]);
      expect(msg).toContain('Failed to parse api.ts');
      // The parser's own message must survive into the note; without it the
      // note cannot be correlated to the real error.
      expect(msg).toMatch(/detection: .+\. The build will surface/);
    } finally {
      warn.mockRestore();
    }
  });
});
