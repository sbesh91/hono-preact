# HeroShader OffscreenCanvas Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the homepage HeroShader's WebGL render loop off the main thread into an OffscreenCanvas worker so the main thread goes idle after hydration, reclaiming Lighthouse TBT/TTI.

**Architecture:** `HeroShader.tsx` becomes a thin main-thread orchestrator that owns the DOM layers and the worker lifecycle (create, transfer canvas, forward resize/visibility/reduced-motion, react to ready/error). A new `shader-worker.ts` owns all WebGL2 and the rAF loop. A new `shader-anim.ts` holds the one pure piece of new logic (the amplitude ramp) so it can be unit-tested. Fallback is two-tier: worker WebGL2, else the static CSS `BASE_GRADIENT`.

**Tech Stack:** Preact + hooks, TypeScript (strict), Vite module workers (`new Worker(new URL(...), { type: 'module' })`), WebGL2, Vitest + happy-dom + @testing-library/preact.

## Global Constraints

- **Progressive enhancement only.** OffscreenCanvas + WebGL2-in-worker is a Newly Available platform feature, not Baseline Widely Available. It must be a pure enhancement over the static `BASE_GRADIENT`, which is the Baseline fallback. Never assume worker/OffscreenCanvas/WebGL2 support.
- **No new dependencies.** Use only platform APIs (`OffscreenCanvas`, `Worker`, `ResizeObserver`, `WebGL2RenderingContext`).
- **Palette coupling.** `BASE_GRADIENT`'s colors must mirror the worker shader's `A`/`B`/`C` constants (`#FFF1ED`≈A, `#FF9F6E`≈B, `#C97DFF`≈C) so the opacity crossfade stays within one color family. If you change one, change the other.
- **Type casts only at real boundaries.** Per CLAUDE.md. The two acceptable seams here: the worker global (`self`, typed `Window` by the DOM lib) and inbound `MessageEvent.data` (untrusted, typed `any`). No other casts.
- **No em-dashes** in code, comments, or commit messages (use commas/parentheses/semicolons).
- **Run `pnpm format` before every commit.** A `format:check` failure is the most common CI miss. Do not commit format-dirty files.
- **TS config facts:** `lib` is `["ESNext","DOM","DOM.Iterable"]` (so `OffscreenCanvas`, `WebGL2RenderingContext`, `MessageEvent`, `performance`, `requestAnimationFrame` are all typed; there is no WebWorker lib). `strict`, `noUnusedLocals`, `noUnusedParameters` are on, so no unused vars/params.

## File Structure

- Create `apps/site/src/components/shader-anim.ts` — pure `rampAmplitude` helper + `AMP_RAMP_MS`. No DOM/GL. Unit-tested.
- Create `apps/site/src/components/__tests__/shader-anim.test.ts` — unit tests for the ramp.
- Create `apps/site/src/components/shader-worker.ts` — the worker: GLSL, GL setup, rAF loop, message handlers, and the exported `WorkerInMsg`/`WorkerOutMsg` protocol types. Not unit-tested (no WebGL2 in happy-dom); verified by typecheck and exercised in CI Lighthouse.
- Modify `apps/site/src/components/HeroShader.tsx` — rewrite as the orchestrator. Keep the markup (3 aria-hidden layers), `FADE_GRADIENT`, and `BASE_GRADIENT`. Remove all GL.
- Modify `apps/site/src/components/__tests__/HeroShader.test.tsx` — replace with worker-orchestration tests.

---

### Task 1: `rampAmplitude` pure helper

**Files:**
- Create: `apps/site/src/components/shader-anim.ts`
- Test: `apps/site/src/components/__tests__/shader-anim.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AMP_RAMP_MS: number` and `rampAmplitude(elapsedMs: number, reduceMotion: boolean, rampMs?: number): number`. Returns 1 immediately when `reduceMotion`, else eases 0→1 linearly over `rampMs` (default `AMP_RAMP_MS`), clamped to [0,1]. Consumed by Task 2's worker.

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/components/__tests__/shader-anim.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rampAmplitude, AMP_RAMP_MS } from '../shader-anim.ts';

describe('rampAmplitude', () => {
  it('returns full amplitude immediately when reduced motion is set', () => {
    expect(rampAmplitude(0, true)).toBe(1);
    expect(rampAmplitude(10_000, true)).toBe(1);
  });

  it('starts at zero so the first animated frame is a flat palette blend', () => {
    expect(rampAmplitude(0, false)).toBe(0);
  });

  it('eases linearly across the ramp window', () => {
    expect(rampAmplitude(AMP_RAMP_MS / 2, false)).toBeCloseTo(0.5, 5);
  });

  it('clamps to full amplitude at and past the ramp window', () => {
    expect(rampAmplitude(AMP_RAMP_MS, false)).toBe(1);
    expect(rampAmplitude(AMP_RAMP_MS * 3, false)).toBe(1);
  });

  it('treats negative elapsed time as zero amplitude', () => {
    expect(rampAmplitude(-50, false)).toBe(0);
  });

  it('honors a custom ramp window', () => {
    expect(rampAmplitude(100, false, 200)).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run apps/site/src/components/__tests__/shader-anim.test.ts`
Expected: FAIL — cannot resolve `../shader-anim.ts` (module does not exist).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/site/src/components/shader-anim.ts`:

```ts
// Duration over which the shader's wave amplitude eases from 0 to 1 on first
// paint, so the static gradient appears to come alive rather than full motion
// snapping on under the canvas fade-in.
export const AMP_RAMP_MS = 800;

// Maps elapsed time since the first painted frame to a wave-amplitude
// multiplier in [0, 1]. Reduced motion skips the ramp and renders a single
// static frame at full amplitude (matching the prior reduced-motion behavior).
export function rampAmplitude(
  elapsedMs: number,
  reduceMotion: boolean,
  rampMs: number = AMP_RAMP_MS
): number {
  if (reduceMotion) return 1;
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= rampMs) return 1;
  return elapsedMs / rampMs;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run apps/site/src/components/__tests__/shader-anim.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add apps/site/src/components/shader-anim.ts apps/site/src/components/__tests__/shader-anim.test.ts
git commit -m "feat(site): add rampAmplitude helper for shader fade-in"
```

---

### Task 2: `shader-worker.ts` (the OffscreenCanvas worker)

**Files:**
- Create: `apps/site/src/components/shader-worker.ts`

**Interfaces:**
- Consumes: `rampAmplitude` from `./shader-anim.ts` (Task 1).
- Produces:
  - `export type WorkerInMsg = { type: 'init'; canvas: OffscreenCanvas; width: number; height: number; reducedMotion: boolean } | { type: 'resize'; width: number; height: number } | { type: 'visibility'; hidden: boolean }`
  - `export type WorkerOutMsg = { type: 'ready' } | { type: 'error' }`
  - The default worker behavior (sets `self.onmessage`). Consumed by Task 3 via `new Worker(new URL('./shader-worker.ts', import.meta.url), { type: 'module' })` and `import type`.

> No unit test: happy-dom has no WebGL2 and the GL code is relocated, already-working logic. The deliverable is verified by typecheck (it must compile) and exercised end-to-end by the CI Lighthouse run. The one piece of genuinely new logic (the amplitude ramp) is unit-tested in Task 1.

**Protocol note (refines the spec):** the spec's `init` listed a `dpr` field; it is omitted here because `width`/`height` are already in device pixels and the worker needs nothing else. The main thread computes `clientWidth * dpr` before posting.

- [ ] **Step 1: Write the worker**

Create `apps/site/src/components/shader-worker.ts`:

```ts
import { rampAmplitude } from './shader-anim.ts';

export type WorkerInMsg =
  | {
      type: 'init';
      canvas: OffscreenCanvas;
      width: number;
      height: number;
      reducedMotion: boolean;
    }
  | { type: 'resize'; width: number; height: number }
  | { type: 'visibility'; hidden: boolean };

export type WorkerOutMsg = { type: 'ready' } | { type: 'error' };

const VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// u_amp scales the wave field; at 0 the shader is a flat palette blend, which is
// what makes the fade-in read as the gradient coming alive. A/B/C must stay in
// sync with BASE_GRADIENT in HeroShader.tsx.
const FS = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_amp;
out vec4 outColor;
void main() {
  vec2 uv = (gl_FragCoord.xy / u_res.xy - 0.5);
  uv.x *= u_res.x / u_res.y;
  float t = u_time * 0.25;
  float v = sin(uv.x * 3.0 + t)
          + sin((uv.y + t) * 4.0)
          + sin((uv.x + uv.y) * 3.0 + t * 1.2)
          + sin(length(uv) * 6.0 - t * 1.5);
  v *= 0.25 * u_amp;
  vec3 A = vec3(1.00, 0.95, 0.93);
  vec3 B = vec3(1.00, 0.62, 0.43);
  vec3 C = vec3(0.79, 0.49, 1.00);
  vec3 col = mix(A, B, 0.5 + 0.5 * v);
  col = mix(col, C, 0.25 * sin(v * 3.1415));
  outColor = vec4(col, 1.0);
}`;

// The worker global. The DOM lib types `self` as `Window`, whose `postMessage`
// signature differs from a worker's, so we alias the one method we call.
const post = (msg: WorkerOutMsg): void =>
  (self as unknown as { postMessage(message: WorkerOutMsg): void }).postMessage(
    msg
  );

let gl: WebGL2RenderingContext | null = null;
let surface: OffscreenCanvas | null = null;
let uRes: WebGLUniformLocation | null = null;
let uTime: WebGLUniformLocation | null = null;
let uAmp: WebGLUniformLocation | null = null;
let rafId = 0;
let t0 = 0;
let firstFrame = true;
let reduceMotion = false;
let width = 0;
let height = 0;

function compile(type: number, src: string): WebGLShader | null {
  if (!gl) return null;
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function setup(init: Extract<WorkerInMsg, { type: 'init' }>): boolean {
  surface = init.canvas;
  width = init.width;
  height = init.height;
  reduceMotion = init.reducedMotion;
  surface.width = width;
  surface.height = height;

  gl = surface.getContext('webgl2', {
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl) return false;

  const vs = compile(gl.VERTEX_SHADER, VS);
  const fs = compile(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return false;

  const prog = gl.createProgram();
  if (!prog) return false;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  uRes = gl.getUniformLocation(prog, 'u_res');
  uTime = gl.getUniformLocation(prog, 'u_time');
  uAmp = gl.getUniformLocation(prog, 'u_amp');
  gl.viewport(0, 0, width, height);
  return true;
}

function drawFrame(): void {
  if (!gl) return;
  const now = performance.now();
  if (firstFrame) t0 = now;
  const elapsed = now - t0;
  gl.uniform2f(uRes, width, height);
  gl.uniform1f(uTime, elapsed / 1000);
  gl.uniform1f(uAmp, rampAmplitude(elapsed, reduceMotion));
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (firstFrame) {
    firstFrame = false;
    // First frame is painted; the main thread now fades the canvas in.
    post({ type: 'ready' });
  }
}

function loop(): void {
  drawFrame();
  rafId = requestAnimationFrame(loop);
}

self.onmessage = (e: MessageEvent): void => {
  const msg = e.data as WorkerInMsg;
  if (msg.type === 'init') {
    if (!setup(msg)) {
      post({ type: 'error' });
      return;
    }
    if (reduceMotion) {
      drawFrame();
    } else {
      rafId = requestAnimationFrame(loop);
    }
  } else if (msg.type === 'resize') {
    width = msg.width;
    height = msg.height;
    if (surface) {
      surface.width = width;
      surface.height = height;
    }
    if (gl) gl.viewport(0, 0, width, height);
  } else if (msg.type === 'visibility') {
    if (msg.hidden) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else if (!reduceMotion && rafId === 0) {
      rafId = requestAnimationFrame(loop);
    }
  }
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter site exec tsc --noEmit`
Expected: PASS (no type errors). If `self.onmessage` or `surface.getContext('webgl2', ...)` reports a type error, confirm the DOM lib is active (it is per the root tsconfig); do not add a WebWorker lib reference (it conflicts with DOM).

- [ ] **Step 3: Format and commit**

```bash
pnpm format
git add apps/site/src/components/shader-worker.ts
git commit -m "feat(site): add OffscreenCanvas shader worker"
```

---

### Task 3: Rewrite `HeroShader.tsx` as the orchestrator

**Files:**
- Modify: `apps/site/src/components/HeroShader.tsx` (full rewrite)
- Modify: `apps/site/src/components/__tests__/HeroShader.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `WorkerInMsg`, `WorkerOutMsg` (types) from `./shader-worker.ts`; the worker module URL via `new Worker(new URL('./shader-worker.ts', import.meta.url), { type: 'module' })`.
- Produces: `export function HeroShader(): JSX.Element` (unchanged public shape — no props, renders the same 3-layer aria-hidden wrapper).

- [ ] **Step 1: Write the failing tests**

Replace the contents of `apps/site/src/components/__tests__/HeroShader.test.tsx`:

```tsx
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

  it('renders the three aria-hidden layers', () => {
    const { container } = render(<HeroShader />);
    const wrapper = container.querySelector('[aria-hidden="true"]')!;
    expect(wrapper.children.length).toBe(3);
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
    constructor(public cb: ResizeObserverCallback) {
      resizeCallbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  beforeEach(() => {
    workers = [];
    resizeCallbacks = [];
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run apps/site/src/components/__tests__/HeroShader.test.tsx`
Expected: FAIL — the current component never constructs a `Worker`, so the worker-path tests fail (e.g. `workers.length` is 0, `expected 0 to be 1`). The no-support tests may pass already.

> If `workers.length` is 0 in a context where you expected the worker to be built, the cause is Vite's worker transform intercepting `new Worker(new URL(...))` rather than calling the stubbed global. This should not happen in Vitest serve mode (it keeps `new Worker` and only rewrites the URL), but if it does, confirm the global stub is installed before `render()` and that `Worker` is read at call time inside the effect (it is).

- [ ] **Step 3: Rewrite the component**

Replace the contents of `apps/site/src/components/HeroShader.tsx`:

```tsx
import { useEffect, useRef, useState } from 'preact/hooks';
import type { WorkerInMsg, WorkerOutMsg } from './shader-worker.ts';

// Fade the shader into the themed page background so it dissolves into the page
// in both light and dark mode (a hardcoded white fade left a seam in dark mode).
const FADE_GRADIENT =
  'linear-gradient(to bottom,' +
  ' transparent 0%,' +
  ' transparent 30%,' +
  ' color-mix(in srgb, var(--background) 35%, transparent) 55%,' +
  ' color-mix(in srgb, var(--background) 75%, transparent) 80%,' +
  ' var(--background) 100%)';

// Always-on base layer. Visible before the first WebGL frame (no white flash on
// load) and as the static fallback when the OffscreenCanvas worker path is
// unavailable. Its colors mirror the worker shader's A/B/C constants so the
// opacity crossfade stays within one color family; keep them in sync.
const BASE_GRADIENT =
  'linear-gradient(135deg, #FFF1ED 0%, #FF9F6E 50%, #C97DFF 100%)';

export function HeroShader() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Progressive enhancement: render the animation in a worker via
    // OffscreenCanvas. Without that support, leave the canvas transparent so
    // BASE_GRADIENT shows through (the static fallback).
    if (
      typeof OffscreenCanvas === 'undefined' ||
      typeof canvas.transferControlToOffscreen !== 'function'
    ) {
      return;
    }

    const dims = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      return {
        width: Math.round(canvas.clientWidth * dpr),
        height: Math.round(canvas.clientHeight * dpr),
      };
    };

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    const worker = new Worker(new URL('./shader-worker.ts', import.meta.url), {
      type: 'module',
    });
    const send = (msg: WorkerInMsg, transfer: Transferable[] = []) =>
      worker.postMessage(msg, transfer);

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      worker.terminate();
    };

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as WorkerOutMsg;
      if (msg.type === 'ready') setReady(true);
      else if (msg.type === 'error') stop();
    };

    const offscreen = canvas.transferControlToOffscreen();
    send({ type: 'init', canvas: offscreen, ...dims(), reducedMotion }, [
      offscreen,
    ]);

    // Observe the canvas (still laid out on the main thread after transfer) and
    // forward device-pixel dimensions. Replaces a per-frame clientWidth read.
    const observer = new ResizeObserver(() => {
      if (!stopped) send({ type: 'resize', ...dims() });
    });
    observer.observe(canvas);

    const onVisibility = () => {
      if (!stopped) send({ type: 'visibility', hidden: document.hidden });
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, []);

  return (
    <div class="absolute inset-0 -z-10 pointer-events-none" aria-hidden="true">
      <div class="absolute inset-0" style={{ background: BASE_GRADIENT }} />
      <canvas
        ref={canvasRef}
        class="absolute inset-0 block w-full h-full"
        style={{
          opacity: ready ? 1 : 0,
          transition: 'opacity 700ms ease-out',
        }}
      />
      <div class="absolute inset-0" style={{ background: FADE_GRADIENT }} />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run apps/site/src/components/__tests__/HeroShader.test.tsx`
Expected: PASS (all tests in both describe blocks).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter site exec tsc --noEmit`
Expected: PASS. (Confirms the `import type` from the worker resolves and the `send`/message types line up.)

- [ ] **Step 6: Format and commit**

```bash
pnpm format
git add apps/site/src/components/HeroShader.tsx apps/site/src/components/__tests__/HeroShader.test.tsx
git commit -m "feat(site): run HeroShader WebGL loop in an OffscreenCanvas worker"
```

---

### Task 4: Full verification and PR

**Files:** none (verification + PR only).

- [ ] **Step 1: Build the framework dist (required before typecheck/site build)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Expected: all package builds succeed.

- [ ] **Step 2: Run the six-step CI sequence in order**

```bash
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: every step passes. If `format:check` fails, run `pnpm format`, re-stage, amend or add a follow-up commit, and re-run. The new `shader-anim` and `HeroShader` tests must appear in the coverage run.

- [ ] **Step 3: Confirm the worker chunk is emitted in the site build**

Run: `ls apps/site/dist/client/assets | grep -i worker || ls apps/site/dist/client/assets`
Expected: a hashed worker chunk (e.g. `shader-worker-*.js`) exists in the client assets, confirming Vite bundled the worker as a separate asset served by Cloudflare.

- [ ] **Step 4: Open the PR**

Use the `superpowers:finishing-a-development-branch` skill to push the branch and open the PR. PR body should state: the goal (move the HeroShader loop off the main thread), the before metrics from the Lighthouse report (TBT 7,030 ms, TTI 11.7 s, main-thread 10.7 s, Performance 70), the two-tier fallback, and that the PR-only Lighthouse CI job's TBT/TTI/Performance delta is the evaluation signal. Note the spec and plan paths.

---

## Self-Review

**1. Spec coverage:**
- Two-tier fallback (worker → BASE_GRADIENT) → Task 3 feature-detect + Task 2 worker `error` path. ✓
- Two units (HeroShader orchestrator, shader-worker) → Tasks 2 and 3. ✓ (plus shader-anim helper for testability)
- Message protocol (init/resize/visibility ; ready/error) → `WorkerInMsg`/`WorkerOutMsg` in Task 2, exercised in Task 3 tests. ✓ (`dpr` dropped from `init`; documented as a refinement since width/height are device px)
- Feature detection (OffscreenCanvas + transferControlToOffscreen on main; webgl2 probe in worker) → Task 3 guard + Task 2 `setup` returning false → `error`. ✓
- Smooth transition #1 no-flash → canvas `opacity:0` until `ready` (Task 3) posted only after first `drawArrays` (Task 2). ✓
- #2 palette continuity → Global Constraint + comments in both files. ✓
- #3 t0 at first draw → `firstFrame` sets `t0` in `drawFrame` (Task 2). ✓
- #4 motion ease-in → `rampAmplitude` (Task 1) driving `u_amp` (Task 2). ✓
- Resize via ResizeObserver (kills per-frame layout) → Task 3. ✓
- Visibility forwarded (no `document` in worker) → Task 3 + Task 2 handler. ✓
- Reduced motion read once on main, single frame in worker → Task 3 `reducedMotion` at init + Task 2 `drawFrame` once. ✓
- Vite worker loading → Task 3 `new Worker(new URL(...))`; emission checked in Task 4 Step 3. ✓
- Testing strategy (mock Worker/OffscreenCanvas/ResizeObserver; worker GL not unit-tested) → Task 3 tests; Task 2 note. ✓
- Out-of-scope items (live reduced-motion change, context-loss, IntersectionObserver) → not implemented, consistent. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". All code blocks complete. ✓

**3. Type consistency:** `WorkerInMsg`/`WorkerOutMsg` defined in Task 2 and imported in Task 3; `rampAmplitude(elapsedMs, reduceMotion, rampMs?)` defined in Task 1 and called as `rampAmplitude(elapsed, reduceMotion)` in Task 2; `dims()` returns `{width,height}` matching the `resize`/`init` message shapes; `transferControlToOffscreen` sentinel `{__offscreen:true}` matches the `toEqual`/`toContainEqual` assertions. ✓
