export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n || 0;
}

// Normalized 0..1 playhead for a pinned stage. `rectTop` is the stage element's
// getBoundingClientRect().top (0 when the stage reaches the viewport top, then
// negative as the reader scrolls past); `stageHeight` is the spacer height and
// `viewportH` is the visible height, so the scrub range is one viewport shorter.
export function computeProgress(
  rectTop: number,
  stageHeight: number,
  viewportH: number
): number {
  const range = Math.max(stageHeight - viewportH, 1);
  return clamp01(-rectTop / range);
}

// Non-pinned, scroll-linked playhead for narrow screens where the stage is not
// pinned (mobile Safari handles a plain scroll listener far better than a tall
// sticky pin). 0 when the element's center sits at the bottom of the viewport,
// 1 when it reaches the top, so the demo still scrubs as it scrolls past.
export function computeScrollLinkedProgress(
  rectTop: number,
  elHeight: number,
  viewportH: number
): number {
  const center = rectTop + elHeight / 2;
  return clamp01((viewportH - center) / Math.max(viewportH, 1));
}

export function sliceProgress(
  parent: number,
  start: number,
  end: number
): number {
  return clamp01((parent - start) / Math.max(end - start, 1e-6));
}

export type BarStatus = 'idle' | 'inflight' | 'done' | 'cancel';

export function barState(
  progress: number,
  start: number,
  size: number,
  cancelAt?: number
): { width: number; state: BarStatus } {
  if (cancelAt != null && progress >= cancelAt) {
    return { width: clamp01((cancelAt - start) / size), state: 'cancel' };
  }
  const width = clamp01((progress - start) / size);
  return {
    width,
    state: width <= 0 ? 'idle' : width >= 1 ? 'done' : 'inflight',
  };
}
