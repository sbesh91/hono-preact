// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { HeroShader } from '../HeroShader.js';

afterEach(() => cleanup());

describe('HeroShader without OffscreenCanvas worker support', () => {
  beforeEach(() => {
    // Force the unsupported branch: no OffscreenCanvas global.
    vi.stubGlobal('OffscreenCanvas', undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the base gradient and canvas layers', () => {
    const { container } = render(<HeroShader />);
    const wrapper = container.querySelector(
      '[aria-hidden="true"]'
    ) as HTMLElement;
    // Two layers now (base gradient + canvas); the bottom dissolve is a mask on
    // the wrapper, not a painted fade layer.
    expect(wrapper.children.length).toBe(2);
  });

  it('keeps the canvas transparent so the base gradient shows', () => {
    const { container } = render(<HeroShader />);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.opacity).toBe('0');
  });

  it('unmounts without throwing', () => {
    const { unmount } = render(<HeroShader />);
    expect(() => unmount()).not.toThrow();
  });
});

describe('HeroShader with OffscreenCanvas worker support', () => {
  let workers: FakeWorker[];
  let resizeCallbacks: ResizeObserverCallback[];
  let resizeObservers: FakeResizeObserver[];

  class FakeWorker {
    posted: unknown[] = [];
    transfers: Transferable[][] = [];
    terminated = false;
    onmessage: ((e: MessageEvent) => void) | null = null;
    constructor(
      public url: URL | string,
      public options?: WorkerOptions
    ) {
      workers.push(this);
    }
    postMessage(message: unknown, transfer: Transferable[] = []) {
      this.posted.push(message);
      this.transfers.push(transfer);
    }
    terminate() {
      this.terminated = true;
    }
    emit(data: unknown) {
      this.onmessage?.({ data } as MessageEvent);
    }
  }

  class FakeResizeObserver {
    disconnected = false;
    constructor(public cb: ResizeObserverCallback) {
      resizeCallbacks.push(cb);
      resizeObservers.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      this.disconnected = true;
    }
  }

  beforeEach(() => {
    workers = [];
    resizeCallbacks = [];
    resizeObservers = [];
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));
    // happy-dom canvases lack transferControlToOffscreen; return a sentinel.
    (
      HTMLCanvasElement.prototype as unknown as {
        transferControlToOffscreen: () => object;
      }
    ).transferControlToOffscreen = () => ({ __offscreen: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (
      HTMLCanvasElement.prototype as {
        transferControlToOffscreen?: unknown;
      }
    ).transferControlToOffscreen;
  });

  it('creates a module worker and posts init with the transferred canvas', () => {
    render(<HeroShader />);
    expect(workers.length).toBe(1);
    const worker = workers[0];
    expect(worker.options?.type).toBe('module');
    const init = worker.posted[0] as { type: string; canvas: unknown };
    expect(init.type).toBe('init');
    expect(init.canvas).toEqual({ __offscreen: true });
    expect(worker.transfers[0]).toContainEqual({ __offscreen: true });
  });

  it('fades the canvas in once the worker reports the first frame is ready', () => {
    const { container } = render(<HeroShader />);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.opacity).toBe('0');
    act(() => workers[0].emit({ type: 'ready' }));
    expect(canvas.style.opacity).toBe('1');
  });

  it('forwards a resize message with numeric dimensions', () => {
    render(<HeroShader />);
    const worker = workers[0];
    const before = worker.posted.length;
    resizeCallbacks[0]([], {} as ResizeObserver);
    const resize = worker.posted[before] as {
      type: string;
      width: number;
      height: number;
    };
    expect(resize.type).toBe('resize');
    expect(typeof resize.width).toBe('number');
    expect(typeof resize.height).toBe('number');
  });

  it('forwards a visibility message on visibilitychange', () => {
    render(<HeroShader />);
    const worker = workers[0];
    const before = worker.posted.length;
    document.dispatchEvent(new Event('visibilitychange'));
    const message = worker.posted[before] as { type: string };
    expect(message.type).toBe('visibility');
  });

  it('terminates the worker when it reports an error', () => {
    render(<HeroShader />);
    const worker = workers[0];
    expect(worker.terminated).toBe(false);
    worker.emit({ type: 'error' });
    expect(worker.terminated).toBe(true);
  });

  it('terminates the worker on unmount', () => {
    const { unmount } = render(<HeroShader />);
    const worker = workers[0];
    unmount();
    expect(worker.terminated).toBe(true);
  });

  it('disconnects the observer and removes the visibilitychange listener on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<HeroShader />);
    unmount();
    expect(resizeObservers[0].disconnected).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function)
    );
    removeSpy.mockRestore();
  });
});

describe('HeroShader with OffscreenCanvas but no transferControlToOffscreen', () => {
  let workers: unknown[];

  class FakeWorker {
    constructor() {
      workers.push(this);
    }
    postMessage() {}
    terminate() {}
  }

  beforeEach(() => {
    workers = [];
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('Worker', FakeWorker);
    // Second bail condition: OffscreenCanvas exists but the canvas cannot be
    // transferred, so the effect must not construct a worker.
    delete (
      HTMLCanvasElement.prototype as {
        transferControlToOffscreen?: unknown;
      }
    ).transferControlToOffscreen;
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not create a worker and leaves the canvas transparent', () => {
    const { container } = render(<HeroShader />);
    expect(workers.length).toBe(0);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.opacity).toBe('0');
  });
});
