// R13. Collect-mode SSR had no server-side coverage at all.
//
// Every streaming test in this directory passed `mode={{ kind: 'single' }}`, but
// `resolveLoaderMode` can never return `single` for an async-generator loader:
// with no `accumulate` it returns `collect`, with one it returns `fold`. So the
// suites pinned a host configuration the public API cannot produce, and the three
// things collect-mode actually does on the server were untested:
//
//   1. it projects `connecting` rather than a settled `success`
//   2. it emits `anchor { kind: 'none' }`, so NO value is baked into `data-loader`
//   3. it provides `LoaderStreamContext` (seeded empty), so a
//      `useData(initial, reduce)` consumer renders instead of hitting the
//      "must be called inside a `loader.Boundary` host" throw
//
// A regression in any of those left render-stream, render-preload,
// render-speculation and render-loader-deny all green.
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { renderPage } from '../render.js';
import { defineLoader } from '@hono-preact/iso';
import {
  Loader,
  resolveLoaderMode,
  LoaderDataContext,
} from '@hono-preact/iso/internal';
import { useContext } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';

async function readBody(res: Response): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

const loc = {
  path: '/',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

/** The mode `loader.Boundary` resolves for a streaming loader. Derived, not a
 * literal, so this test cannot drift from what the public API produces. */
const COLLECT = resolveLoaderMode(undefined, true);

function streamingLoader() {
  return defineLoader<{ count: number }>(async function* () {
    yield { count: 1 };
    yield { count: 2 };
  });
}

describe('renderPage: collect-mode SSR', () => {
  it('resolves to collect for a streaming loader (the premise these tests rest on)', () => {
    // If this ever returns `single`, the rest of the file is testing the wrong
    // thing, so assert the premise rather than assuming it.
    expect(COLLECT).toEqual({ kind: 'collect' });
  });

  it('bakes NO value into data-loader, unlike a single-value host', async () => {
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader mode={COLLECT} loader={streamingLoader()} location={loc}>
          <p>collected</p>
        </Loader>
      )
    );
    const body = await readBody(await app.request('/'));

    expect(body).toContain('collected');
    // `anchor { kind: 'none' }`: a collect consumer reconnects on mount and folds
    // the stream itself, so a baked first chunk would be adopted as a value the
    // client then contradicts.
    expect(body).not.toMatch(/data-loader="\{/);
    expect(body).not.toContain('&quot;count&quot;:1');
  });

  it('still pumps the stream to the client', async () => {
    // The bake and the pump are independent: no `data-loader` value does not mean
    // no chunks. This is what stops the assertion above from passing for the
    // wrong reason (a host that simply never ran the loader).
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader mode={COLLECT} loader={streamingLoader()} location={loc}>
          <p>collected</p>
        </Loader>
      )
    );
    const body = await readBody(await app.request('/'));

    expect(body).toContain('__HP_STREAM__');
    expect(body).toContain('window.__HP_STREAM__.push');
    expect(body).toContain('"count":2');
    expect(body).toContain('window.__HP_STREAM__.end');
  });

  it('projects `connecting` onto the loader channel, not a settled success', async () => {
    // Added after a mutation check: replacing the streaming projection with
    // `{ status: 'success', data: raw }` left the other three tests GREEN,
    // because the `useData(initial, reduce)` consumer below reads
    // `LoaderStreamContext`, not this channel. `LoaderDataContext` is itself an
    // exported internal, so a child CAN observe it -- verified before writing
    // this -- which makes the projection reachable and worth pinning.
    const loader = streamingLoader();
    function Peek() {
      const v = useContext(LoaderDataContext)?.value as
        | { status?: string }
        | null
        | undefined;
      return <p>channel:{v ? String(v.status) : 'null'}</p>;
    }
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader mode={COLLECT} loader={loader} location={loc}>
          <Peek />
        </Loader>
      )
    );
    const body = await readBody(await app.request('/'));

    expect(body).toContain('channel:connecting');
    // A settled `success` here would claim the load completed and bake a value
    // the client is about to contradict by reconnecting.
    expect(body).not.toContain('channel:success');
  });

  it('lets a useData(initial, reduce) descendant render under SSR', async () => {
    // The host seeds `LoaderStreamContext` with an empty log on the server
    // specifically so this consumer sees `connecting` structurally instead of
    // throwing "must be called inside a `loader.Boundary` host". Without that
    // provision this render is a 500.
    const loader = streamingLoader();
    function Total() {
      const s = loader.useData(0, (acc: number, chunk) => acc + chunk.count);
      return <p data-testid="total">{s.value.status}</p>;
    }
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader mode={COLLECT} loader={loader} location={loc}>
          <Total />
        </Loader>
      )
    );
    const res = await app.request('/');
    const body = await readBody(res);

    expect(res.status).toBe(200);
    // `connecting`, not a folded number: the server never delivers chunks to a
    // collect consumer, and the arm carries no data by contract.
    expect(body).toContain('connecting');
    expect(body).not.toContain('must be called inside');
  });
});
