import { useEffect, useRef, useState } from 'preact/hooks';
import type { WorkerInMsg, WorkerOutMsg } from './shader-worker.ts';

// Mask (not paint over) the shader's lower edge to transparent, so it dissolves
// to reveal the same fixed atmospheric ground the chapters sit on. Painting an
// opaque background fade instead left a white band that met the chapters'
// tinted ground on a hard line; masking keeps the ground continuous across the
// hero/chapter seam in both themes.
// The opaque region has to reach past the hero copy: in dark mode the revealed
// ground is dark, so any text sitting in the dissolve zone loses contrast. The
// content is vertically centered, so holding full opacity to 68% keeps the
// lede and CTAs on the bright shader and confines the dissolve to the empty
// strip below them.
const SHADER_MASK =
  'linear-gradient(to bottom, #000 0%, #000 68%, transparent 94%)';

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

    // Pause the render loop when the tab is hidden OR the hero has scrolled out
    // of view. The shader is a continuous WebGL animation; left running while the
    // reader is deep in the chapters it keeps the GPU busy for nothing and
    // contends with scroll compositing, a stutter source on iOS. onScreen starts
    // true so the first frames paint before the observer's first callback.
    let onScreen = true;
    const pushVisibility = () => {
      if (!stopped)
        send({ type: 'visibility', hidden: document.hidden || !onScreen });
    };
    document.addEventListener('visibilitychange', pushVisibility);
    const viewObserver = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      pushVisibility();
    });
    viewObserver.observe(canvas);

    return () => {
      observer.disconnect();
      viewObserver.disconnect();
      document.removeEventListener('visibilitychange', pushVisibility);
      stop();
    };
  }, []);

  return (
    <div
      class="absolute inset-0 -z-10 pointer-events-none"
      aria-hidden="true"
      style={{ maskImage: SHADER_MASK, WebkitMaskImage: SHADER_MASK }}
    >
      <div class="absolute inset-0" style={{ background: BASE_GRADIENT }} />
      <canvas
        ref={canvasRef}
        class="absolute inset-0 block w-full h-full"
        style={{
          opacity: ready ? 1 : 0,
          transition: 'opacity 700ms ease-out',
        }}
      />
      {/* Dark-mode twilight veil. Lives inside the masked wrapper so it dissolves
          with the shader at the lower edge (see .hx-hero__veil); white in light
          mode, so its multiply is a no-op there. */}
      <div class="hx-hero__veil" />
    </div>
  );
}
