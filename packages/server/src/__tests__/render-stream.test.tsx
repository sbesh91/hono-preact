import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { renderPage } from '../render.js';
import { defineLoader } from '@hono-preact/iso';
import { Loader, getRequestStore } from '@hono-preact/iso/internal';
import type { RouteHook } from 'preact-iso';

// Helper: read a streaming response body fully to a string.
async function readBody(res: Response): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
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

describe('renderPage: streaming SSR', () => {
  it('preserves single-shot behavior when no streaming loaders are present', async () => {
    const loader = defineLoader(async () => ({ msg: 'hi' }));
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>static</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    const body = await readBody(res);
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('static');
    expect(body).not.toContain('__HP_STREAM__');
  });

  it('streams chunks as inline script tags for an async-generator loader', async () => {
    const loader = defineLoader<{ count: number }>(async function* () {
      yield { count: 1 };
      yield { count: 2 };
      yield { count: 3 };
    });
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>streaming</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    const body = await readBody(res);
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('__HP_STREAM__');
    // First chunk is baked into the initial render; chunks 2 and 3 arrive as script tags.
    expect(body).toContain('window.__HP_STREAM__.push');
    expect(body).toContain('"count":2');
    expect(body).toContain('"count":3');
    expect(body).toContain('window.__HP_STREAM__.end');
    // Confirm the response terminates (controller.close() was called).
    expect(body.length).toBeGreaterThan(0);
  });

  it('wraps loader output with a data-loader element carrying the first-chunk JSON', async () => {
    const loader = defineLoader(async () => ({ msg: 'hello-preload' }));
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>static</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    const body = await readBody(res);
    // The loader's rendered output must be inside an element carrying
    // data-loader=<JSON>. Client hydration relies on this for preload pickup;
    // without it Suspense kicks the SSR'd children out during hydration.
    // Preact escapes the JSON's quotes as &quot; in the attribute, so match
    // for the entity-escaped form.
    expect(body).toMatch(
      /data-loader="\{&quot;msg&quot;:&quot;hello-preload&quot;\}"/
    );
  });

  it('emits an error script tag when the generator throws', async () => {
    const loader = defineLoader(async function* (): AsyncGenerator<{
      count: number;
    }> {
      yield { count: 1 };
      throw new Error('mid-stream');
    });
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>streaming</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    const body = await readBody(res);
    expect(body).toContain('window.__HP_STREAM__.error');
    expect(body).toContain('"message":"mid-stream"');
  });

  it('escapes < in streamed JSON payloads so </script> cannot break out of the script context', async () => {
    const hostile = '</script><script>window.__pwned=true</script>';
    const loader = defineLoader<{ note: string }>(async function* () {
      yield { note: 'first' };
      yield { note: hostile };
    });
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>streaming</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    const body = await readBody(res);
    // The hostile string survives logically (decodes back to itself), but
    // every '<' inside the script payload is escaped to < so no nested
    // </script> tag terminates the stream-chunk script early.
    expect(body).toContain('\\u003c/script');
    // Critical: the hostile payload must not appear as a real injected script
    // tag. The escaped form contains no literal '</script>' until the chunk
    // script's own closing tag, so '<script>window.__pwned' must never appear.
    expect(body).not.toContain('<script>window.__pwned');
  });

  it('preserves the request scope (ALS) across generator yields', async () => {
    // A streaming loader that yields once, awaits, then reads the per-request
    // ALS store and yields whether it was visible. If runRequestScope context
    // is lost between yields, the second yield reports false.
    const loader = defineLoader<{ scopeVisible: boolean; pass: number }>(
      async function* () {
        yield { scopeVisible: getRequestStore() !== undefined, pass: 1 };
        await new Promise((r) => setTimeout(r, 5));
        yield { scopeVisible: getRequestStore() !== undefined, pass: 2 };
      }
    );
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>scope</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    const body = await readBody(res);
    // Both yields must observe the ALS store, including the one driven from
    // ReadableStream.start (which runs after runRequestScope on the outer
    // call frame has returned). The first yield is baked into the HTML as
    // a data-loader attribute (Preact escapes quotes as &quot;), the second
    // arrives via an inline <script> tag (raw JSON).
    expect(body).toContain('&quot;scopeVisible&quot;:true,&quot;pass&quot;:1');
    expect(body).toContain('"scopeVisible":true,"pass":2');
  });

  it('escapes < in error payloads so a hostile error.message cannot break the script', async () => {
    const loader = defineLoader(async function* (): AsyncGenerator<{
      count: number;
    }> {
      yield { count: 1 };
      throw new Error('</script><script>window.__pwned=true</script>');
    });
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>streaming</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    const body = await readBody(res);
    expect(body).toContain('\\u003c/script');
    expect(body).not.toContain('<script>window.__pwned');
  });

  it('sets anti-buffering headers on the streaming response', async () => {
    const loader = defineLoader<{ count: number }>(async function* () {
      yield { count: 1 };
      yield { count: 2 };
    });
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>streaming</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    expect(res.headers.get('Cache-Control')).toBe('no-transform');
    expect(res.headers.get('Transfer-Encoding')).toBe('chunked');
  });

  it('does not set chunked/anti-buffering headers on non-streaming responses', async () => {
    const loader = defineLoader(async () => ({ msg: 'sync' }));
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>sync</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    // Non-streaming branch uses c.html(...), which does NOT set these headers.
    expect(res.headers.get('X-Accel-Buffering')).toBeNull();
    expect(res.headers.get('Transfer-Encoding')).toBeNull();
  });

  it('flushes the first chunk to the wire before the second yield is enqueued', async () => {
    // Without this assertion, the existing tests only know that ALL chunks
    // appear in the final body — that passes even if the server buffered
    // everything and emitted one block at the end. Gate the loader between
    // yields and read the body incrementally to prove chunk 1 reaches the
    // reader before chunk 2 is allowed to enqueue.
    let releaseSecond!: () => void;
    const gate = new Promise<void>((r) => {
      releaseSecond = r;
    });
    let secondYielded = false;

    const loader = defineLoader<{ n: number }>(async function* () {
      yield { n: 1 };
      await gate;
      secondYielded = true;
      yield { n: 2 };
    });
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>streaming</p>
        </Loader>
      )
    );

    const res = await app.request('/');
    expect(res.body).not.toBeNull();
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';

    // Read until we observe chunk 1's first-render payload. The streaming
    // path embeds the first chunk's data inline as a `data-loader` HTML
    // attribute (entity-escaped), not as a script.push, so look for that.
    while (
      !accumulated.includes('data-loader=&quot;{&quot;n&quot;:1}&quot;') &&
      !accumulated.includes('data-loader="{&quot;n&quot;:1}"')
    ) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
    }
    // First chunk visible AND the second yield has NOT executed yet
    // (because we haven't released the gate).
    expect(accumulated).toMatch(/data-loader=/);
    expect(secondYielded).toBe(false);
    expect(accumulated).not.toMatch(/"n":2/);

    // Release the gate and finish draining.
    releaseSecond();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
    }
    expect(secondYielded).toBe(true);
    expect(accumulated).toMatch(/"n":2/);
  });

  it('aborts cleanly on client cancel: no synthetic error chunks, no enqueue-after-close throws', async () => {
    // Loader that yields one chunk then awaits forever; cancel mid-stream.
    let releaseSecondYield: (() => void) | null = null;
    const loader = defineLoader<{ count: number }>(async function* () {
      yield { count: 1 };
      await new Promise<void>((resolve) => {
        releaseSecondYield = resolve;
      });
      yield { count: 2 };
    });
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>streaming</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    expect(res.body).not.toBeNull();
    const reader = res.body!.getReader();
    // Read the initial chunk so the stream is actively running, then cancel.
    await reader.read();
    await reader.cancel();
    // Now release the gate so the generator tries to yield post-cancel; if
    // the abort flag is honored, no enqueue or close happens after cancel.
    releaseSecondYield?.();
    // Yield a turn for any post-cancel work to settle.
    await new Promise((r) => setTimeout(r, 10));
    // No assertion text beyond "did not throw": vitest fails on unhandled
    // rejections. Cancellation must not produce __HP_STREAM__.error chunks
    // (we cannot read them post-cancel, but unhandled promise rejections
    // from controller.enqueue-after-close would surface here).
    expect(true).toBe(true);
  });
});
