// @vitest-environment happy-dom
// SPIKE (throwaway): the gap the earlier spike files did NOT close. Those used
// `renderToString` directly. This one drives @preact/signals through the REAL
// server path:
//   renderPage -> document shell -> data-loader baked preload
// and then hydrates the actual emitted markup.
//
// The streaming half lives in signals-spike-stream-integration.test.tsx, which
// must run in the `node` environment: cache.ts decides at module load whether
// to initialize AsyncLocalStorage by sniffing real `window`/`document`, so
// under happy-dom the request-scoped streaming registry is inert and renderPage
// can never emit a streaming document. That is a test-harness constraint, not a
// signals interaction.
import { signal } from '@preact/signals';
import { hydrate } from 'preact';
import { Hono } from 'hono';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, waitFor } from '@testing-library/preact';
import type { RouteHook } from 'preact-iso';
import { defineLoader } from '@hono-preact/iso';
import { Loader } from '@hono-preact/iso/internal';
import { __resetStreamRegistryForTests } from '../../../iso/src/internal/stream-registry.js';
import { env } from '@hono-preact/iso/is-browser.js';
import { renderPage } from '../render.js';

const LOC = {
  path: '/',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

const originalEnv = env.current;

afterEach(() => {
  env.current = originalEnv;
  __resetStreamRegistryForTests();
  document.body.innerHTML = '';
  delete (window as { __HP_STREAM__?: unknown }).__HP_STREAM__;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Shell({ children }: { children?: unknown }) {
  return (
    <html>
      <head></head>
      <body>
        <div id="root">{children as never}</div>
      </body>
    </html>
  );
}

async function readBody(res: Response): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out + dec.decode();
}

/** The `<div id="root">…</div>` subtree as emitted by the server. */
function rootMarkup(html: string): string {
  const start = html.indexOf('<div id="root">');
  const end = html.lastIndexOf('</div>');
  if (start < 0 || end < 0) throw new Error('no #root in SSR output');
  return html.slice(start, end + '</div>'.length);
}

describe('GAP A: baked data-loader preload + signals through renderPage', () => {
  it('hydration adopts the SSR value with no refetch, and the signal binds', async () => {
    const label = signal('ssr');
    const renders = vi.fn();

    // __moduleKey set so the client WOULD take the fetch path if the baked
    // preload were not adopted. That makes the no-refetch claim observable
    // rather than assumed.
    const loader = defineLoader<{ msg: string }>(
      async () => ({ msg: 'from-server' }),
      { __moduleKey: 'spike-ssr-a' }
    );

    function Page() {
      renders();
      const s = loader.useData();
      const msg = 'data' in s && s.data ? s.data.msg : 'pending';
      return (
        <p data-testid="page">
          {msg}
          {'|'}
          {label}
        </p>
      );
    }

    const tree = (
      <Loader loader={loader} location={LOC}>
        <Page />
      </Loader>
    );

    // ---- SSR phase ----
    env.current = 'server';
    const app = new Hono();
    app.get('/', (c) => renderPage(c, <Shell>{tree}</Shell>));
    const html = await readBody(await app.request('/'));

    expect(html).toContain('from-server');
    expect(html).toContain('data-loader=');

    // ---- install the real emitted markup ----
    env.current = 'browser';
    document.body.innerHTML = rootMarkup(html);
    const root = document.getElementById('root')!;
    // getPreloadedData() resolves the payload by element id; prove it is there
    // before hydration so a miss is distinguishable from a hydration bug.
    expect(root.querySelector('[data-loader]')).toBeTruthy();

    const fetchSpy = vi.fn(() => {
      throw new Error('client refetched: baked preload was NOT adopted');
    });
    vi.stubGlobal('fetch', fetchSpy);

    // ---- hydrate ----
    await act(async () => {
      hydrate(tree, root);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(root.textContent).toContain('from-server');
    expect(root.textContent).toContain('ssr');

    // ---- granularity on top of a hydrated tree ----
    const before = renders.mock.calls.length;
    await act(async () => {
      label.value = 'client';
    });

    expect(root.textContent).toContain('client');
    expect(root.textContent).toContain('from-server');
    expect(renders.mock.calls.length).toBe(before);
  });
});
