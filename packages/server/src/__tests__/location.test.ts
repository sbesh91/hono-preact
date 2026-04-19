import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('preact-iso/prerender', () => ({
  locationStub: vi.fn(),
}));

import { locationStub } from 'preact-iso/prerender';
import { location } from '../middleware/location.js';

beforeEach(() => {
  vi.mocked(locationStub).mockClear();
});

function makeApp() {
  const app = new Hono();
  app.use(location);
  app.get('*', (c) => c.text('ok'));
  return app;
}

describe('location middleware', () => {
  it('calls locationStub with the request pathname', async () => {
    await makeApp().request('http://localhost/some/path');
    expect(locationStub).toHaveBeenCalledWith('/some/path');
  });

  it('strips query string from the pathname passed to locationStub', async () => {
    await makeApp().request('http://localhost/search?q=hello');
    expect(locationStub).toHaveBeenCalledWith('/search');
  });

  it('calls next() so the handler runs', async () => {
    const res = await makeApp().request('http://localhost/ping');
    expect(await res.text()).toBe('ok');
  });
});
