// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ScrollStage, LiveStage } from '../stage.js';
import { Wire, Lane, Region } from '../primitives.js';
import { ChapterPrefetch } from '../../chapters/ChapterPrefetch.js';
import { ChapterRealtime } from '../../chapters/ChapterRealtime.js';
import { ChapterStreaming } from '../../chapters/ChapterStreaming.js';

afterEach(() => cleanup());

/**
 * The seam between the two halves of the motion system.
 *
 * Continuous motion now lives in root.css as `calc()`/`sin()`/`cos()` over
 * `--hx-p`, which unit tests cannot evaluate. What they *can* pin is the
 * contract: the custom properties and hook classes the stylesheet reads must
 * actually be emitted, with the right values.
 *
 * That is the failure worth catching. A wrong formula is loud, and the first
 * person to open the page sees it. Contract drift is silent: a later refactor
 * drops a style prop or renames a class, the selector stops matching, the
 * element quietly stops moving, and every existing test still passes because
 * none of them ever asserted the animated subject was wired up at all.
 */

describe('lane fill contract (.hx-lane__fill)', () => {
  it('publishes the window and the cancel cap the CSS scales the bar with', () => {
    render(
      <ScrollStage pages={2} fallbackProgress={0}>
        <Wire caption="network">
          <Lane label="GET /feed" start={0.2} size={0.4} />
          <Lane label="cancelled" start={0.2} size={0.4} cancelAt={0.4} />
        </Wire>
      </ScrollStage>
    );
    const [fill, cancelled] = [
      ...document.querySelectorAll<HTMLElement>('.hx-lane__fill'),
    ];

    // scaleX(min(clamp(0, (--hx-p - --lane-start) / --lane-size, 1), --lane-cap))
    expect(fill.style.getPropertyValue('--lane-start')).toBe('0.2');
    expect(fill.style.getPropertyValue('--lane-size')).toBe('0.4');
    expect(fill.style.getPropertyValue('--lane-cap')).toBe('1');

    // A cancelled lane freezes at the width it had reached: (0.4 - 0.2) / 0.4.
    expect(cancelled.style.getPropertyValue('--lane-cap')).toBe('0.5');
  });

  it('gives the wire a playhead track for the CSS to slide', () => {
    render(
      <ScrollStage pages={2} fallbackProgress={0}>
        <Wire caption="network">
          <Lane label="GET /feed" start={0} size={0.5} />
        </Wire>
      </ScrollStage>
    );
    // translateX(var(--hx-p) * 100%) rides the track, not the 2px bar: a
    // percentage translate resolves against the element's own box.
    const track = document.querySelector('.hx-playhead-track');
    expect(track).not.toBeNull();
    expect(track?.querySelector('.hx-playhead')).not.toBeNull();
  });
});

describe('region contract (.hx-region)', () => {
  it('publishes its threshold and its live gate for the CSS crossfade', () => {
    render(
      <ScrollStage pages={2} fallbackProgress={1}>
        <Region showAt={0.37} skeleton={<span>loading</span>}>
          <span>arrived</span>
        </Region>
      </ScrollStage>
    );
    const region = document.querySelector('.hx-region') as HTMLElement;
    // --hx-r: clamp(0, (--hx-p - --region-at) / 0.05, 1)
    expect(region.style.getPropertyValue('--region-at')).toBe('0.37');
    // data-live=false forces --hx-r to 1, so a reader with no client JS can
    // never be stranded on a skeleton.
    expect(region.getAttribute('data-live')).toBe('true');
  });
});

describe('peer orbit contract (.hx-rt-peer-anchor)', () => {
  it('publishes all five orbit terms per peer', () => {
    render(<ChapterRealtime />);
    const anchors = [
      ...document.querySelectorAll<HTMLElement>('.hx-rt-peer-anchor'),
    ];
    expect(anchors).toHaveLength(5);

    // translate(50% + sin(--hx-p*2pi * --sx + --ph) * --rx * 1%, ...cos...--sy...--ry)
    // Drop any one of these and all five cursors pile up, motionless, at the
    // room's centre.
    for (const anchor of anchors) {
      for (const term of ['--rx', '--ry', '--sx', '--sy', '--ph']) {
        expect(anchor.style.getPropertyValue(term)).not.toBe('');
      }
    }
    // Distinct paths, not five copies of one orbit.
    const paths = anchors.map((a) => a.getAttribute('style'));
    expect(new Set(paths).size).toBe(5);
  });
});

describe('animated subjects survive their chapters', () => {
  it('keeps the prefetch cursor the CSS glides along its travel window', () => {
    render(<ChapterPrefetch />);
    // --travel: clamp(0, (--hx-p - 0.04) / 0.24, 1) rides this element.
    expect(document.querySelector('.hx-prefetch__cursor')).not.toBeNull();
  });

  it('keeps the chart clip the CSS reveals the line with', () => {
    render(<ChapterStreaming />);
    // width: calc(2px + var(--hx-p) * 116px) is set on this rect.
    expect(document.querySelector('.hx-chart__clip')).not.toBeNull();
    expect(document.querySelector('.hx-chart__now')).not.toBeNull();
  });
});

describe('the playhead itself', () => {
  it('is seeded on every stage kind so CSS always has a number to read', () => {
    render(
      <LiveStage periodMs={4200} fallbackProgress={0.5}>
        <Wire caption="ws">
          <Lane label="WS" start={0} size={0.12} />
        </Wire>
      </LiveStage>
    );
    const live = document.querySelector('.hx-live') as HTMLElement;
    expect(live.style.getPropertyValue('--hx-p')).toBe('0.5');
  });
});
