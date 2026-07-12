export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n || 0;
}

// Normalized 0..1 playhead for a pinned stage. `rectTop` is the stage element's
// getBoundingClientRect().top (0 when the stage reaches the viewport top, then
// negative as the reader scrolls past) and `stageHeight` is the spacer height.
//
// `pinHeight` is the height of the sticky pin itself, NOT window.innerHeight. A
// pin stuck at top:0 releases once the stage's bottom edge catches the pin's
// bottom edge, so the scrub range is exactly `stageHeight - pinHeight`. The pin
// is sized in `svh` (the small viewport, toolbar showing) while innerHeight on
// mobile grows toward `lvh` as the URL bar collapses, so measuring the window
// instead of the pin shortens the range by the toolbar's height: the playhead
// then saturates at 1 while the scene is still pinned, and the last stretch of
// the scrub sits frozen on an already-finished scene.
export function computeProgress(
  rectTop: number,
  stageHeight: number,
  pinHeight: number
): number {
  const range = Math.max(stageHeight - pinHeight, 1);
  return clamp01(-rectTop / range);
}

export function sliceProgress(
  parent: number,
  start: number,
  end: number
): number {
  return clamp01((parent - start) / Math.max(end - start, 1e-6));
}

export type BarStatus = 'idle' | 'inflight' | 'done' | 'cancel';

// A lane's *width* is not computed here any more: CSS derives it from the shared
// --hx-p custom property, so the fill scales on the compositor with no render at
// all (see .hx-lane__fill). These two cover the parts CSS cannot express.

// The width a lane freezes at, as a 0..1 fraction of its track: a cancelled lane
// stops growing at `cancelAt`, an uncancelled one runs to full. This is the
// `--lane-cap` the CSS clamps the fill against, and because the fill only ever
// grows with progress, capping it is all "freeze on cancel" has to mean.
export function laneCap(
  start: number,
  size: number,
  cancelAt?: number
): number {
  return cancelAt == null ? 1 : clamp01((cancelAt - start) / size);
}

// The lane's discrete status, which picks its color. Four values across a whole
// scrub, so a component reading this re-renders a handful of times rather than
// once a frame.
export function barStatus(
  progress: number,
  start: number,
  size: number,
  cancelAt?: number
): BarStatus {
  if (cancelAt != null && progress >= cancelAt) return 'cancel';
  const width = clamp01((progress - start) / size);
  return width <= 0 ? 'idle' : width >= 1 ? 'done' : 'inflight';
}
