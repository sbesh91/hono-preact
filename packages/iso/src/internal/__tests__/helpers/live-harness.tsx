import type { ComponentChildren } from 'preact';
import { vi } from 'vitest';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../../../define-loader.js';
import { Loader } from '../../loader.js';
import { useReload } from '../../../reload-context.js';

let harnessCounter = 0;

/**
 * Drive a live (streaming) loader's REAL client subscription (the exact
 * `fetch` + SSE mechanism `loader-streaming.test.tsx` exercises via
 * `dripSseResponse`/`openSseResponse`) with a `push` the test controls
 * directly, instead of a pre-declared chunk list. `push` writes straight onto
 * the mocked SSE response's `ReadableStream` controller, so every chunk still
 * travels through the real `fetchLoaderData` -> `readSSE` -> `pumpStream`
 * pipeline (`loader-fetch.ts` / `sse-decoder.ts`); nothing here reimplements
 * streaming.
 *
 * The loader's own `fn` is an async generator that is never actually invoked:
 * a `__moduleKey`-bound loader running in the browser always takes the fetch
 * path (`loader-runner.ts`'s `useFetchPath` branch), never the direct-fn path.
 * Declaring it as an async generator is what makes `defineLoader` infer
 * `LoaderRef<T, true>` (the streaming overload) with no cast.
 */
export function makeLiveLoaderHarness<T>() {
  const moduleKey = `test-live-harness-${harnessCounter++}`;
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let subscriptions = 0;

  const fetchMock = vi.fn().mockImplementation(() => {
    subscriptions += 1;
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controller = ctrl;
      },
    });
    return Promise.resolve(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );
  });
  vi.stubGlobal('fetch', fetchMock);

  // Never invoked (see the doc comment above); its shape only exists to make
  // `defineLoader` infer the streaming (`Live=true`) overload.
  async function* neverInvoked(): AsyncGenerator<T, void, unknown> {
    /* the harness always takes the client fetch path */
  }

  const loader = defineLoader<T>(neverInvoked, {
    __moduleKey: moduleKey,
    live: true,
  });

  // Captured from inside the tree so `reload()` below can drive the SAME
  // `useReload()` a real consumer would call, exercising the real resubscribe
  // path (`requestReload` -> `runReload` -> `subscribeCollect` ->
  // `resetCollectSignals`) rather than reaching into internals.
  let capturedReload: (() => void) | null = null;
  function ReloadCapture() {
    capturedReload = useReload().reload;
    return null;
  }

  function Host({ children }: { children: ComponentChildren }) {
    return (
      <LocationProvider>
        <Loader
          loader={loader}
          mode={{ kind: 'collect' }}
          location={{ path: '/', pathParams: {}, searchParams: {} } as never}
        >
          <ReloadCapture />
          {children}
        </Loader>
      </LocationProvider>
    );
  }

  /**
   * Push one chunk onto the open SSE connection and wait for it to travel the
   * whole real pipeline (`TextDecoderStream` -> the line-split transform ->
   * `readSSE` -> `pumpStream` -> `applyCollectChunk`'s signal write) before
   * returning. That pipeline crosses several pipe-stage microtask hops (more
   * than `dripSseResponse`'s single `await Promise.resolve()` per chunk
   * budgets for, since that helper's OWN callers additionally poll via
   * `waitFor`); a macrotask tick reliably drains all of them.
   */
  async function push(chunk: T): Promise<void> {
    if (!controller) {
      throw new Error(
        'makeLiveLoaderHarness: push() called before the stream connection opened; render <Host> first.'
      );
    }
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Drive a reload through the SAME `useReload()` a real consumer under the
   * host would call (captured via `<ReloadCapture>`, mounted inside `<Host>`).
   * Runs the real resubscribe path: `requestReload` -> `runReload` ->
   * `subscribeCollect` -> `resetCollectSignals` -> a fresh `fetch()` call
   * (so `push` after this lands on the NEW connection, not the old one).
   */
  async function reload(): Promise<void> {
    if (!capturedReload) {
      throw new Error(
        'makeLiveLoaderHarness: reload() called before <Host> mounted (no useReload() captured yet).'
      );
    }
    capturedReload();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    Host,
    loader,
    push,
    reload,
    subscriptionCount: () => subscriptions,
  };
}
