import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { serverActions } from '../login.server.js';
import { resetDemoData, findUserByEmail } from '../../../demo/data.js';
import { DEMO_SESSION_COOKIE } from '../../../demo/session.js';

// defineAction returns the handler function as-is (no wrapper object).
// So serverActions.login IS the ActionFn; we cast and call it directly.
// The full /__actions wire is integration-tested in packages/server;
// here we only check the action handler's behavior.

describe('login action', () => {
  beforeEach(() => resetDemoData());

  it('upserts the user and sets a session cookie', async () => {
    const app = new Hono();
    let captured: {
      user: ReturnType<typeof findUserByEmail>;
      cookieSet: string | null;
    } = {
      user: null,
      cookieSet: null,
    };
    app.post('/', async (c) => {
      try {
        await (serverActions.login as unknown as Function)(
          { c, signal: new AbortController().signal },
          { email: 'newuser@example.com', name: 'New User' }
        );
      } catch (e) {
        const o = e as { __outcome?: string };
        if (o.__outcome !== 'redirect') throw e;
      }
      captured.user = findUserByEmail('newuser@example.com');
      captured.cookieSet = c.res.headers.get('set-cookie');
      return c.text('ok');
    });
    const res = await app.request('/', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(captured.user?.name).toBe('New User');
    expect(captured.cookieSet).toMatch(new RegExp(`${DEMO_SESSION_COOKIE}=`));
  });

  it('rejects an empty email', async () => {
    const app = new Hono();
    let threw: Error | null = null;
    app.post('/', async (c) => {
      try {
        await (serverActions.login as unknown as Function)(
          { c, signal: new AbortController().signal },
          { email: '', name: '' }
        );
      } catch (e) {
        threw = e as Error;
      }
      return c.text('ok');
    });
    await app.request('/', { method: 'POST' });
    expect(threw).not.toBe(null);
    expect(threw!.message).toMatch(/email/i);
  });
});
