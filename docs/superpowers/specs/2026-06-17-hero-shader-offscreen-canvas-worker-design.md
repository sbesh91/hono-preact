# HeroShader: move the WebGL render loop to an OffscreenCanvas worker

Date: 2026-06-17
Status: Design approved, prototype

## Problem

A mobile Lighthouse run of the site homepage (`localhost:8788/`, LH 12.6.1) scores
Performance **70**. Loading metrics are excellent (FCP 1.2s, LCP 1.2s, CLS 0.009,
Speed Index 2.5s), but:

- Total Blocking Time: **7,030 ms** (score 0)
- Time to Interactive: **11.7 s** (score 17)
- Main-thread work: **10.7 s**, of which ~10.4 s is the "Other" (GPU/compositor)
  bucket and only ~186 ms is script evaluation.
- ~50 long tasks of ~200 ms each, all attributed to `home-*.js`.

The cause is the `requestAnimationFrame` loop in `apps/site/src/components/HeroShader.tsx`.
It runs a full-screen WebGL2 fragment shader uncapped on the main thread for the
entire trace. A perpetual main-thread animation means Lighthouse's TTI never finds
its required 5 s of main-thread quiet, and TBT accumulates continuously.

## Goal

Move the render loop off the main thread using `OffscreenCanvas` +
`transferControlToOffscreen()` and a dedicated Web Worker, so the main thread goes
idle after hydration. This is a **prototype to evaluate**: the hypothesis is that
relocating the loop reclaims TBT/TTI on the homepage while keeping the animation
on capable browsers.

## Non-goals (out of scope for this prototype)

- Live response to `prefers-reduced-motion` changes (read once at init, as today).
- WebGL context-loss recovery / mid-run fade-back-to-gradient.
- `IntersectionObserver` scroll-pause when the hero leaves the viewport.
- Keeping a main-thread WebGL render path as a fallback (see Fallback below).

These are noted so they can be added later if the prototype proves out.

## Fallback strategy (two-tier)

Worker WebGL2 → CSS `BASE_GRADIENT`. There is no main-thread WebGL render path.
Browsers without OffscreenCanvas-in-worker (or without WebGL2 inside a worker) get
the already-shipped static gradient, which looks good and is the current no-WebGL2
fallback. This keeps the diff small and makes the core question ("is the main
thread actually idle now?") unambiguous.

## Architecture

Two units with a single message boundary:

### `HeroShader.tsx` (main thread) — DOM + lifecycle only

Renders the same three layers it does today:

1. `BASE_GRADIENT` div (always visible, underneath).
2. `<canvas>` (starts `opacity: 0`, fades to `1` on first frame).
3. `FADE_GRADIENT` div (on top, dissolves the shader into the themed page bg).

In `useEffect` (browser-only, so SSR/hydration are untouched):

- Feature-detect worker support.
- Create the worker, `transferControlToOffscreen()`, post `init`.
- Observe size (`ResizeObserver`), document visibility (`visibilitychange`), and
  read `prefers-reduced-motion` once; forward these to the worker.
- On `ready`, set the `ready` state (triggers the CSS opacity fade-in).
- On `error`, `terminate()` the worker (gradient stays visible).
- On unmount, `terminate()` the worker (kills the loop + GL context; no manual
  GL teardown needed on the main thread anymore).

No GL code lives here. `BASE_GRADIENT`/`FADE_GRADIENT` stay here because they read
theme tokens via CSS (a DOM concern).

### `shader-worker.ts` (worker, new file) — all WebGL2

Owns the `VS`/`FS` GLSL constants, program/buffer/uniform setup, the rAF loop, and
message handling. This is where the render loop now lives, so the main thread stays
idle. Responsibilities:

- On `init`: get `webgl2` context from the transferred `OffscreenCanvas`. If absent,
  or shaders fail to compile/link, post `{type:'error'}` and stop.
- Set canvas drawing-buffer size from the device-pixel dims passed by main.
- Run the loop (or, if `reducedMotion`, draw a single frame). Post `{type:'ready'}`
  after the first frame is painted.
- Handle `resize` (update `canvas.width/height` + `gl.viewport`) and `visibility`
  (cancel/restart the rAF).

## Message protocol

Main → worker:

- `init`: `{ type: 'init', canvas: OffscreenCanvas /* transferred */, width, height, reducedMotion }`
  where `width`/`height` are device pixels (`clientWidth * dpr`). The main thread
  applies the device-pixel ratio before posting, so the worker needs no `dpr`.
- `resize`: `{ type: 'resize', width, height }` (device pixels).
- `visibility`: `{ type: 'visibility', hidden: boolean }`.

Worker → main:

- `ready`: `{ type: 'ready' }` — first frame painted; main starts the fade-in.
- `error`: `{ type: 'error' }` — no worker-WebGL2 or shader setup failed; main
  terminates the worker and leaves the gradient.

## Feature detection

Main thread:

```
typeof OffscreenCanvas !== 'undefined' &&
typeof canvas.transferControlToOffscreen === 'function'
```

WebGL2-in-worker cannot be detected from the main thread, so the worker probes it
(`getContext('webgl2')`) and reports failure via the `error` message. Both
"no OffscreenCanvas" and "OffscreenCanvas but no worker-WebGL2" degrade to the
static gradient.

## Smooth gradient ↔ WebGL transition

Four mechanisms, all in scope:

1. **No-flash invariant.** The canvas is held at `opacity: 0` until the worker
   confirms its first frame is *painted* (`ready`). Only then does the
   `opacity 0→1` crossfade (700 ms ease-out) begin, with `BASE_GRADIENT` underneath
   throughout. No blank/black canvas flash regardless of worker spawn latency.
2. **Palette continuity (invariant to protect).** `BASE_GRADIENT` already uses the
   shader's exact `A`/`B`/`C` colors (`#FFF1ED`≈A, `#FF9F6E`≈B, `#C97DFF`≈C), so the
   crossfade is within one color family (static gradient → animated field of the
   same hues), not a swap between unrelated images. The spec records this coupling
   so a future `BASE_GRADIENT` edit doesn't silently break the handoff.
3. **`t0` set at first draw**, not at worker construction, so `u_time` starts near
   zero on the first *visible* frame and motion begins from a calm state coherent
   with the fade-in, independent of worker spawn latency.
4. **Motion ease-in.** The worker ramps the shader's wave amplitude from 0→1 over
   the first ~800 ms via one extra uniform. At amplitude 0 the shader is a flat
   blend of the same palette, so the gradient appears to "come alive" under the
   rising opacity rather than full-amplitude waves snapping on.

Reverse direction (WebGL → gradient) only occurs on `error` before `ready` (canvas
was never visible; gradient just stays) or on unmount. Mid-run context-loss
fade-out is out of scope.

## Resize / visibility / reduced-motion

- **Resize:** a `ResizeObserver` on the canvas (which the main thread still lays out
  even after transfer) computes `dpr = min(devicePixelRatio, 2)` and posts new
  device-pixel dims on change. This replaces the current per-frame
  `canvas.clientWidth/clientHeight` read, eliminating a forced layout every frame.
- **Visibility:** `document` is unavailable in the worker, so the main thread
  listens to `visibilitychange` and forwards `hidden`; the worker pauses/resumes its
  rAF accordingly.
- **Reduced motion:** `matchMedia` is unavailable in the worker, so the main thread
  reads `prefers-reduced-motion` once and passes it at `init`. When set, the worker
  draws a single frame and posts `ready`, then idles (no loop).

## Vite worker loading

`new Worker(new URL('./shader-worker.ts', import.meta.url), { type: 'module' })` —
Vite's standard module-worker form. It emits a separate chunk into `dist/client`
(the Cloudflare assets dir), served as a static asset. The worker is constructed
only inside `useEffect`, so the SSR build and hydration never touch it.

## Testing

TDD targets the main-thread orchestration; mock `OffscreenCanvas`,
`HTMLCanvasElement.prototype.transferControlToOffscreen`, and `Worker`:

- No OffscreenCanvas support → no worker constructed; canvas stays `opacity: 0`,
  gradient layers render.
- Capable env → worker constructed; `init` posted with a transferred canvas and
  device-pixel dims.
- `ResizeObserver` change → `resize` posted with new dims.
- `visibilitychange` → `visibility` posted with `hidden`.
- `ready` message → canvas reaches `opacity: 1`.
- `error` message → `worker.terminate()` called; canvas stays hidden.
- Unmount → `worker.terminate()` called.

The worker's GL itself is not unit-tested (jsdom has no WebGL2); its logic is the
relocated, already-working code. The existing `HeroShader.test.tsx` is updated to
cover the orchestration above.

## File changes

- `apps/site/src/components/HeroShader.tsx` — rewritten as the main-thread
  orchestrator (DOM layers + worker lifecycle + message forwarding). `VS`/`FS` move
  out; `BASE_GRADIENT`/`FADE_GRADIENT` stay.
- `apps/site/src/components/shader-worker.ts` — new worker: GLSL constants, GL
  setup, rAF loop with amplitude ramp, message handlers.
- `apps/site/src/components/__tests__/HeroShader.test.tsx` — updated for the
  worker-orchestration contract.

## Verification

Before opening the PR, run the six-step pre-push CI sequence
(build → format:check → typecheck → test:coverage → test:integration → site build).
Lighthouse runs in CI on the PR; the prototype's value is judged by the
TBT/TTI/Performance delta in that report.
