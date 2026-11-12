import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ClientScript } from '@hono-preact/iso';
import {
  CLIENT_ENTRY_URL,
  VIRTUAL_CLIENT_DEV_URL,
} from '@hono-preact/iso/internal/contract';
import { renderPage } from '../render.js';

// A Node server loads hono-preact externalized, where Vite never injects
// `import.meta.env`, so `<ClientScript />` must take its dev/prod choice from
// renderPage's `dev` option. Vitest sets `import.meta.env.PROD` to false, so the
// production case only passes when the option actually reaches the component.
const Doc = () => (
  <html>
    <body>
      <main id="app">ok</main>
      <ClientScript />
    </body>
  </html>
);

async function scriptSrc(dev: boolean | undefined) {
  const app = new Hono();
  app.get('*', (c) =>
    renderPage(c, <Doc />, dev === undefined ? undefined : { dev })
  );
  const html = await (await app.request('http://localhost/')).text();
  return html.match(/<script type="module" src="([^"]+)"/)?.[1];
}

describe('renderPage threads its dev flag to <ClientScript />', () => {
  it('points at the built client entry when dev is false', async () => {
    expect(await scriptSrc(false)).toBe(CLIENT_ENTRY_URL);
  });

  it('points at the dev virtual module when dev is true', async () => {
    expect(await scriptSrc(true)).toBe(VIRTUAL_CLIENT_DEV_URL);
  });

  // A custom server entry that omits `dev` keeps the build-time choice; under
  // Vitest that is dev.
  it('falls back to the build env when no dev option is passed', async () => {
    expect(await scriptSrc(undefined)).toBe(VIRTUAL_CLIENT_DEV_URL);
  });
});
