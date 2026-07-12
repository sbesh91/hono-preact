// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { ScrollStage, useStageValue } from '../stage.js';
import { Region } from '../primitives.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  const progress = useStageValue((p) => p);
  return <span data-testid="p">{progress.toFixed(2)}</span>;
}

/** matchMedia reporting `reduce`, which is what a reduced-motion reader gets. */
function stubReducedMotion() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('ScrollStage', () => {
  it('provides the fallback frame on first render (SSR parity)', () => {
    render(
      <ScrollStage pages={3} fallbackProgress={0.5}>
        <Probe />
      </ScrollStage>
    );
    expect(screen.getByTestId('p').textContent).toBe('0.50');
  });

  it('seeds --hx-p with the fallback so the CSS-driven scene renders settled without JS', () => {
    // Every continuous visual on the page is a CSS function of --hx-p. If the
    // server did not seed it, a no-JS reader would get the scene at whatever
    // @property's initial-value is (0) rather than at the stage's fallback:
    // empty lanes, hidden regions, an unmorphed card.
    render(
      <ScrollStage pages={3} fallbackProgress={0.85}>
        <Probe />
      </ScrollStage>
    );
    const pin = document.querySelector('.hx-stage__pin') as HTMLElement;
    expect(pin.style.getPropertyValue('--hx-p')).toBe('0.85');
  });
});

describe('ScrollStage under reduced motion', () => {
  it('drops out of live, so a Region cannot be stranded on its skeleton', () => {
    // The trap: prefers-reduced-motion starts false so the first client render
    // matches SSR, so the stage mounts live (live: true) and only then learns the
    // reader wants reduced motion. Nothing drives the playhead in the static
    // branch, so if `live` stayed true the Region would sit waiting for a
    // threshold that can never arrive and the reader would keep the skeleton
    // forever. A skeleton must never be the terminal state.
    stubReducedMotion();
    render(
      <ScrollStage pages={3} fallbackProgress={0.2}>
        <Region showAt={0.9} skeleton={<span>loading</span>}>
          <span>Invoice #102000</span>
        </Region>
      </ScrollStage>
    );
    const stage = document.querySelector('.hx-stage') as HTMLElement;
    expect(stage.classList.contains('hx-stage--static')).toBe(true);

    // fallback 0.2 never reaches showAt 0.9, so this is only true if `live` fell
    // back with the media query.
    const region = document.querySelector('.hx-region') as HTMLElement;
    expect(region.getAttribute('data-live')).toBe('false');
    expect(region.getAttribute('data-shown')).toBe('true');
  });

  it('still seeds --hx-p, so the CSS-derived scene renders settled', () => {
    stubReducedMotion();
    render(
      <ScrollStage pages={3} fallbackProgress={0.6}>
        <Probe />
      </ScrollStage>
    );
    const stage = document.querySelector('.hx-stage') as HTMLElement;
    expect(stage.style.getPropertyValue('--hx-p')).toBe('0.6');
  });
});

describe('useStageValue', () => {
  it('derives its value from the fallback playhead on first render', () => {
    // Static mount only. The claim that it does not re-render *per tick* cannot
    // be made here, because nothing drives the playhead in this file: asserting
    // a render count against a stage that never moves is vacuous, and an earlier
    // version of this test did exactly that and passed against a useStageValue
    // that re-rendered on every frame. That claim is tested in driver.test.tsx.
    render(
      <ScrollStage pages={2} fallbackProgress={0.5}>
        <Threshold />
      </ScrollStage>
    );
    expect(screen.getByTestId('t').textContent).toBe('true');
  });
});

function Threshold() {
  const past = useStageValue((p: number) => p > 0.4);
  return <span data-testid="t">{String(past)}</span>;
}
