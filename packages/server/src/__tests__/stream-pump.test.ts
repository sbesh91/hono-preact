import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ServerLoaderStream } from '@hono-preact/iso/internal';
import { streamDocumentResponse } from '../stream-pump.js';

// Direct unit harness for `streamDocumentResponse` (the SSR streaming pump). The
// only prior coverage (`stream-wire-contract.test.ts`) exercises the bootstrap /
// chunk script BUILDERS, not the pump body; renderPage integration covers the
// happy path but not the edge paths (backpressure pacing, request-signal abort,
// consumer cancel). This drives the pump in isolation with controllable
// generators and a real AbortController.

const HTML_WITH_BODY = '<html><body>shell</body></html>';

/**
 * A generator whose yields are driven by an explicit array, instrumented so the
 * test can observe how far the pump has pulled it (`nextCount`, for backpressure
 * assertions) and whether the pump aborted it early (`return()` spy). `throwAt`
 * makes it throw on a given step to exercise the per-loader error path.
 */
function makeLoader(
  loaderId: string,
  values: unknown[],
  opts: { throwAt?: number } = {}
): {
  stream: ServerLoaderStream;
  nextCount: () => number;
  returnSpy: ReturnType<typeof vi.fn>;
} {
  let nextCount = 0;
  async function* run(): AsyncGenerator<unknown, void, unknown> {
    for (let i = 0; i < values.length; i++) {
      nextCount++;
      if (opts.throwAt === i) throw new Error(`boom:${loaderId}`);
      yield values[i];
    }
  }
  const gen = run();
  const returnSpy = vi.fn(gen.return.bind(gen));
  gen.return = returnSpy as typeof gen.return;
  return { stream: { loaderId, gen }, nextCount: () => nextCount, returnSpy };
}

/** Run the pump inside a real Hono Context so `c.body(...)` is genuine. */
async function runPump(opts: {
  fullHtml: string;
  streamingLoaders: ServerLoaderStream[];
  requestSignal: AbortSignal;
  bindRequestScope?: <R>(fn: () => R | Promise<R>) => R | Promise<R>;
}): Promise<Response> {
  const app = new Hono();
  app.get('/', (c: Context) =>
    streamDocumentResponse(c, {
      fullHtml: opts.fullHtml,
      streamingLoaders: opts.streamingLoaders,
      requestSignal: opts.requestSignal,
      bindRequestScope: opts.bindRequestScope ?? ((fn) => fn()),
    })
  );
  return app.request('http://localhost/');
}

/** Drain a response body to a single decoded string. */
async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
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

describe('streamDocumentResponse', () => {
  it('emits doctype + shell + bootstrap, then per-chunk push/end scripts, then the closing tags', async () => {
    const ac = new AbortController();
    const a = makeLoader('a', [{ n: 1 }, { n: 2 }]);
    const res = await runPump({
      fullHtml: HTML_WITH_BODY,
      streamingLoaders: [a.stream],
      requestSignal: ac.signal,
    });

    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('Transfer-Encoding')).toBe('chunked');

    const html = await readAll(res);
    // Shell precedes the bootstrap precedes the chunk scripts precedes </body>.
    expect(html.startsWith('<!doctype html><html><body>shell')).toBe(true);
    expect(html).toContain('window.__HP_STREAM__');
    expect(html).toContain('.push("a",{"n":1})');
    expect(html).toContain('.push("a",{"n":2})');
    expect(html).toContain('.end("a")');
    expect(html.endsWith('</body></html>')).toBe(true);
    // Ordering: push(1) before push(2) before end before the closing tags.
    expect(html.indexOf('{"n":1}')).toBeLessThan(html.indexOf('{"n":2}'));
    expect(html.indexOf('{"n":2}')).toBeLessThan(html.indexOf('.end("a")'));
    expect(html.indexOf('.end("a")')).toBeLessThan(html.indexOf('</body>'));
  });

  it('interleaves multiple loaders and emits the closing tags only after all complete', async () => {
    const ac = new AbortController();
    const a = makeLoader('a', ['a0']);
    const b = makeLoader('b', ['b0', 'b1']);
    const res = await runPump({
      fullHtml: HTML_WITH_BODY,
      streamingLoaders: [a.stream, b.stream],
      requestSignal: ac.signal,
    });

    const html = await readAll(res);
    expect(html).toContain('.push("a","a0")');
    expect(html).toContain('.push("b","b0")');
    expect(html).toContain('.push("b","b1")');
    expect(html).toContain('.end("a")');
    expect(html).toContain('.end("b")');
    // afterBody (the closing tags) is written once, after every loader ended.
    expect(html.indexOf('.end("a")')).toBeLessThan(html.indexOf('</body>'));
    expect(html.indexOf('.end("b")')).toBeLessThan(html.indexOf('</body>'));
    expect(html.endsWith('</body></html>')).toBe(true);
  });

  it('emits an error script when a loader generator throws, and still closes the document', async () => {
    const ac = new AbortController();
    // Throws on the first step (before yielding anything).
    const a = makeLoader('a', ['never'], { throwAt: 0 });
    const res = await runPump({
      fullHtml: HTML_WITH_BODY,
      streamingLoaders: [a.stream],
      requestSignal: ac.signal,
    });

    const html = await readAll(res);
    expect(html).toContain('.error("a",{"message":"boom:a","name":"Error"})');
    // The pump caught the per-loader error and still wrote the closing tags.
    expect(html.endsWith('</body></html>')).toBe(true);
  });

  it('paces generators by consumer read rate (backpressure): an unread stream does not drain the generator', async () => {
    const ac = new AbortController();
    // A generator with far more chunks than any buffer would hold.
    const a = makeLoader(
      'a',
      Array.from({ length: 100 }, (_, i) => i)
    );
    const res = await runPump({
      fullHtml: HTML_WITH_BODY,
      streamingLoaders: [a.stream],
      requestSignal: ac.signal,
    });

    // Do NOT read the body. Give the pump several turns to run as far as it can.
    await new Promise((r) => setTimeout(r, 20));

    // The pump wrote the shell, then blocked on `writer.ready` for the first
    // chunk because nobody is reading. So it pulled the generator at most a
    // couple of times, NOT all 100 — proving writes are paced by backpressure.
    expect(a.nextCount()).toBeLessThanOrEqual(3);

    // Clean up: abort so the fire-and-forget pump settles.
    ac.abort();
    await res.body!.cancel().catch(() => {});
  });

  it('aborts every loader generator and stops writing when the request signal aborts', async () => {
    const ac = new AbortController();
    const a = makeLoader(
      'a',
      Array.from({ length: 100 }, (_, i) => i)
    );
    const b = makeLoader(
      'b',
      Array.from({ length: 100 }, (_, i) => i)
    );
    const res = await runPump({
      fullHtml: HTML_WITH_BODY,
      streamingLoaders: [a.stream, b.stream],
      requestSignal: ac.signal,
    });

    const reader = res.body!.getReader();
    // Read the first chunk (the shell) to let the pump start.
    await reader.read();
    ac.abort();

    // Both generators are returned (cleaned up) on abort.
    expect(a.returnSpy).toHaveBeenCalled();
    expect(b.returnSpy).toHaveBeenCalled();

    // The stream terminates (the writer was aborted) rather than completing
    // with the closing tags.
    let tail = '';
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        tail += decoder.decode(value, { stream: true });
      }
    } catch {
      /* aborted writer surfaces as a read rejection on some runtimes */
    }
    expect(tail).not.toContain('</body></html>');
  });

  it('aborts every loader generator when the consumer cancels the readable side', async () => {
    const ac = new AbortController();
    const a = makeLoader(
      'a',
      Array.from({ length: 100 }, (_, i) => i)
    );
    const res = await runPump({
      fullHtml: HTML_WITH_BODY,
      streamingLoaders: [a.stream],
      requestSignal: ac.signal,
    });

    const reader = res.body!.getReader();
    await reader.read(); // shell
    await reader.cancel(); // consumer drops the response

    // `writer.closed` rejects, which propagates to gen.return().
    await vi.waitFor(() => expect(a.returnSpy).toHaveBeenCalled());
  });

  it('appends scripts after the whole document when there is no </body> marker', async () => {
    const ac = new AbortController();
    const a = makeLoader('a', ['x']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await runPump({
      fullHtml: '<html>no-body-close</html>',
      streamingLoaders: [a.stream],
      requestSignal: ac.signal,
    });

    const html = await readAll(res);
    // beforeBody is the entire html; afterBody is empty, so the bootstrap and
    // chunk scripts land after the full document.
    expect(html.startsWith('<!doctype html><html>no-body-close</html>')).toBe(
      true
    );
    expect(html.indexOf('</html>')).toBeLessThan(
      html.indexOf('window.__HP_STREAM__')
    );
    expect(html).toContain('.push("a","x")');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('runs the pump inside the supplied request-scope binder', async () => {
    const ac = new AbortController();
    const a = makeLoader('a', ['x']);
    let entered = 0;
    const res = await runPump({
      fullHtml: HTML_WITH_BODY,
      streamingLoaders: [a.stream],
      requestSignal: ac.signal,
      bindRequestScope: (fn) => {
        entered++;
        return fn();
      },
    });

    await readAll(res);
    // The pump body (which resumes the generators) ran through the binder, so a
    // captured per-request scope is restored for generator continuations.
    expect(entered).toBe(1);
  });
});
