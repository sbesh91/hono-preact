// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/preact';
import { ScrollStage, useStageValue } from '../stage.js';

/**
 * Tests for ScrollStage's scroll *driver*, as opposed to the pure math it calls.
 *
 * This is where the two things that actually matter live, and neither was
 * observable before: the driver is what picks the scrub's denominator (the bug
 * this file's first test guards), and it is what decides how often a subscriber
 * re-renders (the whole reason the store exists). `progress.test.ts` covers the
 * arithmetic, but arithmetic was never wrong: the caller was passing it the
 * wrong argument.
 */

// An iPhone-shaped stage: a 3-page pin at 100svh, in a window whose innerHeight
// has grown to ~lvh because the URL bar has collapsed. svh != innerHeight is the
// entire point of the fixture; making them equal would make the test vacuous.
const STAGE_H = 2235; // 3 x 745svh
const PIN_H = 745; // 100svh, toolbar showing
const INNER_H = 852; // window.innerHeight once the URL bar collapses (~lvh)

let scrollY = 0;

function scroll(y: number): void {
  act(() => {
    scrollY = y;
    window.dispatchEvent(new Event('scroll'));
  });
}

/** Enough of a layout engine for the driver to run: happy-dom has no geometry. */
function stubDriver(): void {
  scrollY = 0;
  vi.stubGlobal('innerHeight', INNER_H);
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get: () => scrollY,
  });
  // Run the rAF callback synchronously, and return 0: the driver guards on
  // `!raf`, so a truthy handle would make it think a frame is already pending
  // and silently drop every subsequent scroll.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true }]);
      }
      disconnect() {}
      unobserve() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains('hx-stage')) return STAGE_H;
      if (this.classList.contains('hx-stage__pin')) return PIN_H;
      return 0;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    // Only the stage's top is read, and only to derive its document offset.
    return {
      top: this.classList.contains('hx-stage') ? -scrollY : 0,
    } as DOMRect;
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
});

function Probe() {
  const progress = useStageValue((p) => p);
  return <span data-testid="p">{progress.toFixed(2)}</span>;
}

const playhead = () =>
  (
    document.querySelector('.hx-stage__pin') as HTMLElement
  ).style.getPropertyValue('--hx-p');

describe('ScrollStage driver', () => {
  it('scrubs against the pin, not the window', () => {
    // The regression. A sticky pin releases when the stage's bottom catches the
    // pin's bottom, so the scrub range is `stageHeight - pinHeight`. The pin is
    // sized in svh; window.innerHeight grows toward lvh as a mobile URL bar
    // collapses. Measuring the window shortens the range by the toolbar's
    // height, so the playhead saturates at 1 while the scene is still pinned and
    // the last stretch of the scrub sits frozen on a finished scene.
    //
    // Note this cannot be caught in progress.test.ts: computeProgress's body is
    // unchanged, and always divided by whatever it was handed. The defect was
    // the argument, so the test has to observe the caller.
    stubDriver();
    render(
      <ScrollStage pages={3} fallbackProgress={0}>
        <span />
      </ScrollStage>
    );

    scroll(1400);
    // Honest: 1400 / (2235 - 745). Measuring the window gives 1400 / (2235 - 852),
    // which is > 1 and clamps to '1.0000'.
    expect(playhead()).toBe('0.9396');

    scroll(STAGE_H - PIN_H);
    expect(playhead()).toBe('1.0000'); // saturates exactly as the pin releases
  });

  it('drives the playhead from 0 at the top to 1 at the release', () => {
    stubDriver();
    render(
      <ScrollStage pages={3} fallbackProgress={0.5}>
        <span />
      </ScrollStage>
    );

    scroll(0);
    expect(playhead()).toBe('0.0000');
    scroll((STAGE_H - PIN_H) / 2);
    expect(playhead()).toBe('0.5000');
    scroll(STAGE_H); // past the release: clamped, never overshoots
    expect(playhead()).toBe('1.0000');
  });
});

describe('a mid-session reduced-motion flip', () => {
  it('freezes the JS playhead at the same fallback the CSS is frozen at', () => {
    // prefers-reduced-motion is a live media query, so it can flip while the
    // reader is part-way through a stage. The static branch pins --hx-p to
    // `fallbackProgress` for CSS; the JS half has to land on the same number, or
    // the scene splits: CSS renders the settled morph while JS still reports it
    // closed and captions it "scroll to morph the card into its page".
    stubDriver();
    const listeners = new Set<() => void>();
    let reduce = false;
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return reduce && query.includes('prefers-reduced-motion');
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));

    render(
      <ScrollStage pages={3} fallbackProgress={0.9}>
        <Probe />
      </ScrollStage>
    );

    // Scrub to a third of the way in: JS and CSS agree, both at ~0.34.
    scroll((STAGE_H - PIN_H) / 3);
    expect(screen.getByTestId('p').textContent).toBe('0.33');

    // The reader switches Reduce Motion on, right here.
    act(() => {
      reduce = true;
      for (const fn of listeners) fn();
    });

    // CSS is now pinned to the fallback on the static stage...
    const stage = document.querySelector('.hx-stage') as HTMLElement;
    expect(stage.classList.contains('hx-stage--static')).toBe(true);
    expect(stage.style.getPropertyValue('--hx-p')).toBe('0.9');
    // ...and JS must report the very same frame, not the stale 0.33 it was on.
    expect(screen.getByTestId('p').textContent).toBe('0.90');
  });
});

describe('useStageValue', () => {
  it('does not re-render a threshold subscriber on every playhead tick', () => {
    // The claim the whole store+selector rewrite exists to make. Without a
    // driver this is unobservable, which is how the original version of this
    // test passed against a `useStageValue` that re-rendered on every frame.
    stubDriver();
    let renders = 0;
    function Threshold() {
      renders++;
      const past = useStageValue((p) => p > 0.4);
      return <span data-testid="t">{String(past)}</span>;
    }
    render(
      <ScrollStage pages={3} fallbackProgress={0}>
        <Threshold />
      </ScrollStage>
    );

    scroll(1000); // crosses 0.4 (1000/1490 = 0.67): the value flips, once
    const afterCross = renders;
    expect(document.querySelector('[data-testid="t"]')?.textContent).toBe(
      'true'
    );

    // 30 more frames, all past the threshold: the derived value never changes,
    // so not one of them may cost a render.
    for (let y = 1010; y <= 1300; y += 10) scroll(y);
    expect(renders).toBe(afterCross);
  });

  it('re-renders exactly once per change of the derived value', () => {
    stubDriver();
    let renders = 0;
    function Quartile() {
      renders++;
      const q = useStageValue((p) => Math.min(3, Math.floor(p * 4)));
      return <span data-testid="q">{q}</span>;
    }
    render(
      <ScrollStage pages={3} fallbackProgress={0}>
        <Quartile />
      </ScrollStage>
    );
    const base = renders;

    // Walk the whole scrub in 60 frames. The selector takes 4 values, so it may
    // cost at most 3 renders however many frames it took to get there.
    for (let i = 1; i <= 60; i++) scroll(((STAGE_H - PIN_H) * i) / 60);
    expect(document.querySelector('[data-testid="q"]')?.textContent).toBe('3');
    expect(renders - base).toBe(3);
  });
});
