// @vitest-environment node
// SPIKE (throwaway): the streaming half of the gap. Drives @preact/signals
// through renderPage's REAL streaming document (the __HP_STREAM__ bootstrap
// plus interleaved per-chunk <script> tags), then hydrates that exact markup in
// the actual browser order: markup parsed, inline scripts executed,
// installStreamRegistry() (what boot-client does), hydrate().
//
// Why `node` and not `happy-dom`: cache.ts decides at MODULE LOAD whether to
// initialize AsyncLocalStorage, by sniffing real `window`/`document`. Under the
// happy-dom environment that check is true, ALS is never created, the
// request-scoped streaming registry is inert, and renderPage silently falls
// back to a single-shot response. So the SSR half must load in node, and the
// DOM is installed afterwards, by hand, only for the hydration half.
import { signal } from '@preact/signals';
import { hydrate } from 'preact';
import { useContext } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { Hono } from 'hono';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RouteHook } from 'preact-iso';
import { defineLoader } from '@hono-preact/iso';
import { Loader } from '@hono-preact/iso/internal';
import { installStreamRegistry } from '@hono-preact/iso/internal/runtime';
import { LoaderDataContext } from '../../../iso/src/internal/contexts.js';
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
  for (const k of ['window', 'document', 'Node', 'Element']) {
    delete (globalThis as Record<string, unknown>)[k];
  }
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

/** Drive preact's async flush until `done()` or the budget runs out. */
async function flush(done: () => boolean, turns = 20): Promise<void> {
  for (let i = 0; i < turns && !done(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function rootMarkup(html: string): string {
  const start = html.indexOf('<div id="root">');
  const end = html.indexOf('</div>', start);
  if (start < 0 || end < 0) throw new Error('no #root in SSR output');
  return html.slice(start, end + '</div>'.length);
}

/** Inline <script> bodies, in document order. */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/**
 * Install a real DOM and parse the server's markup into it, then run the
 * server's inline scripts the way a browser would. The scripts touch only
 * `window` (global by then) and `document.currentScript.remove()`, so a
 * shadowing `document` parameter stands in for the self-removal.
 */
async function installBrowser(html: string): Promise<Element> {
  const { Window } = await import('happy-dom');
  const win = new Window({ url: 'http://localhost/' });
  const g = globalThis as Record<string, unknown>;
  g.window = win;
  g.document = win.document;
  // `navigator` is a getter-only global in Node 24 and preact does not need it.
  g.Node = win.Node;
  g.Element = win.Element;

  win.document.body.innerHTML = rootMarkup(html).replace(
    /<script>[\s\S]*?<\/script>/g,
    ''
  );

  for (const src of inlineScripts(html)) {
    new Function('document', src)({ currentScript: { remove() {} } });
  }

  return win.document.getElementById('root') as unknown as Element;
}

describe('GAP B: streaming SSR chunk scripts + signals through renderPage', () => {
  it('drains the __HP_STREAM__ bootstrap into the hydrated tree, signal intact', async () => {
    const label = signal('s0');
    const pageRenders = vi.fn();

    // Bare async-generator loader under <Loader>: the shape renderPage actually
    // turns into a streaming document (mirrors render-stream.test.tsx).
    const loader = defineLoader<{ count: number }>(async function* () {
      yield { count: 1 };
      yield { count: 2 };
      yield { count: 3 };
    });

    // `useData()` is rejected for a streaming loader by design, so read the
    // same context `.View` consumes.
    function Page() {
      pageRenders();
      const ctx = useContext(LoaderDataContext);
      const data =
        ctx && 'data' in ctx
          ? (ctx.data as { count: number } | undefined)
          : undefined;
      return (
        <p data-testid="stream">
          {String(data?.count ?? 0)}
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

    // ---- SSR phase (node, ALS live) ----
    env.current = 'server';
    const app = new Hono();
    app.get('/', (c) => renderPage(c, <Shell>{tree}</Shell>));
    const html = await readBody(await app.request('/'));

    // The real streaming document, produced with a signal in the tree.
    expect(html).toContain('__HP_STREAM__');
    expect(html).toContain('window.__HP_STREAM__.push');
    expect(html).toContain('"count":2');
    expect(html).toContain('"count":3');
    expect(html).toContain('window.__HP_STREAM__.end');
    // First chunk is baked into the markup, and the signal SSR'd beside it.
    expect(html).toContain('1|s0');

    // ---- browser phase ----
    env.current = 'browser';
    const root = await installBrowser(html);

    const queued = (
      globalThis as unknown as {
        window: { __HP_STREAM__?: { queue?: unknown[] } };
      }
    ).window.__HP_STREAM__?.queue;
    expect(Array.isArray(queued)).toBe(true);
    // Chunks 2 and 3 plus the end event buffered before the bundle evaluated.
    expect(queued!.length).toBeGreaterThan(0);

    // What boot-client does once the client bundle evaluates.
    installStreamRegistry();

    await act(() => {
      hydrate(tree, root);
    });

    // The buffered replay lands over a few async turns (subscribe happens in a
    // post-commit effect, then each queued event applies through state).
    await flush(() => root.textContent?.includes('3') === true);

    // The buffered chunks replayed into the subscriber hydration mounted.
    expect(root.textContent).toContain('3');

    // ---- granularity survives the streaming path ----
    const before = pageRenders.mock.calls.length;
    await act(() => {
      label.value = 's1';
    });

    expect(root.textContent).toContain('s1');
    expect(root.textContent).toContain('3');
    expect(pageRenders.mock.calls.length).toBe(before);
  });
});
