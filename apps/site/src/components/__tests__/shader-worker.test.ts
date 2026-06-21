import { afterEach, describe, it, expect, vi } from 'vitest';

// The worker module wires up `self.onmessage` at import time and renders through
// a WebGL2 context obtained from the transferred OffscreenCanvas. These tests
// drive the message handler with a fake `self`, a fake OffscreenCanvas, and a
// fake WebGL2 context so we can assert *when* a frame is drawn without a real
// GPU. `requestAnimationFrame` is stubbed to NOT invoke its callback, so the
// only draws observed are the synchronous ones the handler performs itself.

type Drawable = { drawArrays: ReturnType<typeof vi.fn> };

function makeFakeGl() {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    TRIANGLES: 8,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    viewport: vi.fn(),
    uniform2f: vi.fn(),
    uniform1f: vi.fn(),
    drawArrays: vi.fn(),
  };
  return gl;
}

function makeSurface(gl: object) {
  return { width: 0, height: 0, getContext: vi.fn(() => gl) };
}

type FakeSelf = {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
};

async function loadWorker() {
  const self: FakeSelf = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal('self', self);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('performance', { now: vi.fn(() => 0) });
  vi.resetModules();
  await import('../shader-worker.ts');
  return self;
}

function init(
  self: FakeSelf,
  surface: object,
  reducedMotion = true,
  width = 100,
  height = 50
) {
  self.onmessage!({
    data: { type: 'init', canvas: surface, width, height, reducedMotion },
  } as MessageEvent);
}

function resize(self: FakeSelf, width: number, height: number) {
  self.onmessage!({ data: { type: 'resize', width, height } } as MessageEvent);
}

describe('shader-worker resize handling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('redraws synchronously when the canvas is resized', async () => {
    const gl = makeFakeGl();
    const surface = makeSurface(gl);
    const self = await loadWorker();

    // Reduced motion draws exactly one static frame on init and does not start
    // a RAF loop, so any further draw must come from the resize handler itself.
    init(self, surface);
    const before = (gl as Drawable).drawArrays.mock.calls.length;

    resize(self, 200, 80);

    expect((gl as Drawable).drawArrays.mock.calls.length).toBe(before + 1);
  });

  it('resizes the drawing buffer and viewport to the new dimensions', async () => {
    const gl = makeFakeGl();
    const surface = makeSurface(gl);
    const self = await loadWorker();

    init(self, surface);
    resize(self, 200, 80);

    expect(surface.width).toBe(200);
    expect(surface.height).toBe(80);
    expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 200, 80);
  });

  it('skips redraw for a no-op resize to the same dimensions', async () => {
    const gl = makeFakeGl();
    const surface = makeSurface(gl);
    const self = await loadWorker();

    init(self, surface, true, 100, 50);
    const before = (gl as Drawable).drawArrays.mock.calls.length;

    resize(self, 100, 50);

    expect((gl as Drawable).drawArrays.mock.calls.length).toBe(before);
  });
});
