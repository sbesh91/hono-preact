import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { setSignedCookie, getSignedCookie } from 'hono/cookie';
import { defineServerGuard } from '@hono-preact/iso';
import { Guards } from '@hono-preact/iso/internal';
import type { RouteHook } from 'preact-iso';
import { renderPage } from '../render.js';

const loc = {
  path: '/protected',
  url: 'http://localhost/protected',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const SECRET = 'test-secret-do-not-use-in-prod';

describe('end-to-end cookie auth pattern', () => {
  it('a server guard reads a signed cookie via getSignedCookie(ctx.c, …)', async () => {
    let userObserved: string | null = null;

    const requireSignedSession = defineServerGuard(async (ctx, next) => {
      const user = await getSignedCookie(ctx.c, SECRET, 'session');
      if (!user) return { redirect: '/login' };
      userObserved = user;
      return next();
    });

    const ProtectedPage = () => (
      <html>
        <body>
          <Guards guards={[requireSignedSession]} location={loc}>
            <div>secret</div>
          </Guards>
        </body>
      </html>
    );

    const app = new Hono();
    app.get('/login-as/:user', async (c) => {
      await setSignedCookie(c, 'session', c.req.param('user'), SECRET);
      return c.text('ok');
    });
    app.get('/protected', (c) => renderPage(c, <ProtectedPage />));

    // Prime the cookie jar.
    const loginRes = await app.request('http://localhost/login-as/alice');
    const cookie = loginRes.headers.get('set-cookie');
    expect(cookie).toBeTruthy();

    // Hit the protected page with the signed cookie present.
    const okRes = await app.request('http://localhost/protected', {
      headers: { cookie: cookie! },
    });
    expect(okRes.status).toBe(200);
    expect(userObserved).toBe('alice');

    // Hit the protected page with no cookie -> redirect.
    const redirectRes = await app.request('http://localhost/protected');
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.get('location')).toBe('/login');
  });
});
