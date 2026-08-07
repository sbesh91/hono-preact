// @vitest-environment happy-dom
// These exercise the reader-mode dispatch directly: no component, no renderer,
// no act(). Before the reader factories were extracted from `useLoaderRunner`
// none of this was reachable except by mounting a <Loader> and inferring the
// mode from what rendered.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RouteHook } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { createLoaderSession } from '../loader-session.js';
import {
  buildLoaderReader,
  selectReaderMode,
  type LoaderPhaseOps,
} from '../loader-readers.js';

const LOC = {
  path: '/',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

/** A recording stand-in for the loader's write surface. */
function spyOps<T>(): LoaderPhaseOps<T> & { readonly log: string[] } {
  const log: string[] = [];
  return {
    log,
    setPhase: () => log.push('setPhase'),
    setStatus: (s) => log.push(`setStatus:${s}`),
    setError: () => log.push('setError'),
    applyChunk: () => log.push('applyChunk'),
    subscribeStream: () => {
      log.push('subscribeStream');
      return new Promise<T>(() => {});
    },
  };
}

/** Plant the SSR envelope element the preload/deny readers look up by id. */
function plantEnvelope(id: string, attrs: Record<string, string>): void {
  const el = document.createElement('section');
  el.id = id;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('buildLoaderReader: mode dispatch', () => {
  it('adopts an SSR-baked deny and returns a stub reader without fetching', () => {
    plantEnvelope('L1', {
      'data-loader-deny': JSON.stringify({ message: 'nope' }),
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const ref = defineLoader<{ n: number }>(async () => ({ n: 1 }), {
      __moduleKey: 'm',
    });
    const session = createLoaderSession<{ n: number }>();
    const ops = spyOps<{ n: number }>();

    const reader = buildLoaderReader({
      session,
      ops,
      loaderRef: ref,
      location: LOC,
      locKey: 'k',
      id: 'L1',
      mode: { kind: 'single' },
    });

    expect(session.denyConsumed).toBe(true);
    expect(session.bakedDeny).toBeInstanceOf(Error);
    expect(session.bakedDeny?.message).toBe('nope');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(session.inFlight).toBe(false);
    expect(reader.read()).toBeUndefined();
  });

  it('adopts an SSR preload as a structurally-present sync value and seeds the cache', () => {
    plantEnvelope('L2', { 'data-loader': JSON.stringify({ n: 7 }) });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const ref = defineLoader<{ n: number }>(async () => ({ n: 0 }), {
      __moduleKey: 'm',
    });
    const session = createLoaderSession<{ n: number }>();

    const reader = buildLoaderReader({
      session,
      ops: spyOps<{ n: number }>(),
      loaderRef: ref,
      location: LOC,
      locKey: 'k2',
      id: 'L2',
      mode: { kind: 'single' },
    });

    expect(session.preloadConsumed).toBe(true);
    expect(session.sync).toEqual({ present: true, value: { n: 7 } });
    expect(ref.cache.get('k2')).toEqual({ n: 7 });
    expect(reader.read()).toEqual({ n: 7 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('adopts a preloaded null as PRESENT rather than treating it as absent', () => {
    // The structural-presence rule: a baked `null` is a real value, not "no
    // value". Getting this wrong reintroduces a hydration refetch flash.
    plantEnvelope('L3', { 'data-loader': 'null' });

    const ref = defineLoader<null>(async () => null, { __moduleKey: 'm' });
    const session = createLoaderSession<null>();

    buildLoaderReader({
      session,
      ops: spyOps<null>(),
      loaderRef: ref,
      location: LOC,
      locKey: 'k3',
      id: 'L3',
      mode: { kind: 'single' },
    });

    expect(session.sync).toEqual({ present: true, value: null });
  });

  it('serves a browser cache hit synchronously without fetching', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const ref = defineLoader<{ n: number }>(async () => ({ n: 0 }), {
      __moduleKey: 'm',
    });
    ref.cache.set({ n: 42 }, 'k4');
    const session = createLoaderSession<{ n: number }>();

    const reader = buildLoaderReader({
      session,
      ops: spyOps<{ n: number }>(),
      loaderRef: ref,
      location: LOC,
      locKey: 'k4',
      id: 'L4',
      mode: { kind: 'single' },
    });

    expect(session.sync).toEqual({ present: true, value: { n: 42 } });
    expect(reader.read()).toEqual({ n: 42 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(session.inFlight).toBe(false);
  });

  it('falls through to a cold fetch and marks the session in-flight', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    );

    const ref = defineLoader<{ n: number }>(async () => ({ n: 0 }), {
      __moduleKey: 'm',
    });
    const session = createLoaderSession<{ n: number }>();

    buildLoaderReader({
      session,
      ops: spyOps<{ n: number }>(),
      loaderRef: ref,
      location: LOC,
      locKey: 'k5',
      id: 'L5',
      mode: { kind: 'single' },
    });

    expect(session.inFlight).toBe(true);
    expect(session.sync).toEqual({ present: false });
  });

  it('takes the streaming subscription when a consumption accumulator is present', () => {
    const ref = defineLoader<{ n: number }>(
      // eslint-disable-next-line require-yield
      async function* () {
        return;
      },
      { __moduleKey: 'm' }
    );
    const session = createLoaderSession<{ n: number }>();
    const ops = spyOps<{ n: number }>();

    buildLoaderReader({
      session,
      ops,
      loaderRef: ref,
      location: LOC,
      locKey: 'k6',
      id: 'L6',
      mode: { kind: 'fold', initial: { n: 0 }, reduce: (_a, c) => c },
    });

    expect(ops.log).toContain('subscribeStream');
    expect(session.inFlight).toBe(true);
  });

  it('gives a deny precedence over a value preload on the same envelope', () => {
    // Both attributes present is not a shape the server emits, but the
    // precedence is load-bearing: a denied streaming loader must not
    // resubscribe over SSE and re-hit the denied loader.
    plantEnvelope('L7', {
      'data-loader': JSON.stringify({ n: 1 }),
      'data-loader-deny': JSON.stringify({ message: 'denied' }),
    });

    const ref = defineLoader<{ n: number }>(async () => ({ n: 0 }), {
      __moduleKey: 'm',
    });
    const session = createLoaderSession<{ n: number }>();

    buildLoaderReader({
      session,
      ops: spyOps<{ n: number }>(),
      loaderRef: ref,
      location: LOC,
      locKey: 'k7',
      id: 'L7',
      mode: { kind: 'single' },
    });

    expect(session.bakedDeny?.message).toBe('denied');
    expect(session.sync).toEqual({ present: false });
  });

  // The one precedence pair the dispatch tests never covered: an SSR preload and
  // a browser cache entry both available on a first render. The preload has to
  // win, or a client navigation back to a page whose cache still holds an older
  // value would render that older value over the freshly server-rendered one.
  it('gives an SSR preload precedence over a browser cache hit', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    plantEnvelope('L8', { 'data-loader': JSON.stringify({ n: 99 }) });

    const ref = defineLoader<{ n: number }>(async () => ({ n: 0 }), {
      __moduleKey: 'm',
    });
    ref.cache.set({ n: 1 }, 'k8'); // a stale cache entry for the same key
    const session = createLoaderSession<{ n: number }>();

    const reader = buildLoaderReader({
      session,
      ops: spyOps<{ n: number }>(),
      loaderRef: ref,
      location: LOC,
      locKey: 'k8',
      id: 'L8',
      mode: { kind: 'single' },
    });

    expect(reader.read()).toEqual({ n: 99 });
    expect(session.sync).toEqual({ present: true, value: { n: 99 } });
    // Preload-specific bookkeeping the cache reader does not do: the attribute
    // is marked consumed, and the stale cache entry is overwritten.
    expect(session.preloadConsumed).toBe(true);
    expect(ref.cache.get('k8')).toEqual({ n: 99 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// `selectReaderMode` is pure, so the precedence rule can be read off as a table
// instead of inferred from which side effects a built reader happened to leave
// behind. These cover the ordering itself; the dispatch tests above cover what
// each mode then DOES.
describe('selectReaderMode: the precedence table', () => {
  const ref = () =>
    defineLoader<{ n: number }>(async () => ({ n: 0 }), { __moduleKey: 'm' });
  // A distinct locKey per case: loaders share a cache, so a key reused across
  // cases leaks a previous case's entry into this one.
  const pick = (
    id: string,
    loaderRef: ReturnType<typeof ref>,
    locKey: string,
    mode: Parameters<typeof selectReaderMode>[0]['mode'] = { kind: 'single' }
  ) =>
    selectReaderMode<{ n: number }>({
      session: createLoaderSession<{ n: number }>(),
      loaderRef,
      locKey,
      id,
      mode,
    }).kind;

  it('deny outranks everything, including a streaming mode', () => {
    plantEnvelope('P1', {
      'data-loader': JSON.stringify({ n: 1 }),
      'data-loader-deny': JSON.stringify({ message: 'no' }),
    });
    const r = ref();
    r.cache.set({ n: 2 }, 'p1');
    expect(pick('P1', r, 'p1', { kind: 'collect' })).toBe('bakedDeny');
  });

  it('streaming outranks a preload and a cache hit', () => {
    plantEnvelope('P2', { 'data-loader': JSON.stringify({ n: 1 }) });
    const r = ref();
    r.cache.set({ n: 2 }, 'p2');
    expect(pick('P2', r, 'p2', { kind: 'collect' })).toBe('streaming');
  });

  it('preload outranks a cache hit', () => {
    plantEnvelope('P3', { 'data-loader': JSON.stringify({ n: 1 }) });
    const r = ref();
    r.cache.set({ n: 2 }, 'p3');
    expect(pick('P3', r, 'p3')).toBe('preload');
  });

  it('cache outranks a cold fetch', () => {
    const r = ref();
    r.cache.set({ n: 2 }, 'p4');
    expect(pick('P4', r, 'p4')).toBe('cache');
  });

  it('falls through to a cold fetch with nothing available', () => {
    expect(pick('P5', ref(), 'p5')).toBe('cold');
  });

  it('ignores the SSR envelope after the first render', () => {
    // `session.reader !== null` means a client navigation: the same <section>
    // is still mounted carrying a stale attribute, and adopting it would skip
    // the fetch.
    plantEnvelope('P6', { 'data-loader': JSON.stringify({ n: 1 }) });
    const session = createLoaderSession<{ n: number }>();
    session.reader = { read: () => ({ n: 0 }) };
    expect(
      selectReaderMode<{ n: number }>({
        session,
        loaderRef: ref(),
        locKey: 'p6',
        id: 'P6',
        mode: { kind: 'single' },
      }).kind
    ).toBe('cold');
  });
});
