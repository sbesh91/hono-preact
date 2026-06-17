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
