// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { ScrollStage, Actor, useStageProgress } from '../stage.js';

afterEach(() => cleanup());

function Probe() {
  const { progress } = useStageProgress();
  return <span data-testid="p">{progress.toFixed(2)}</span>;
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
});

describe('Actor', () => {
  it('re-normalizes the parent playhead to a local 0..1', () => {
    render(
      <ScrollStage pages={2} fallbackProgress={0.5}>
        <Actor start={0.25} end={0.75}>
          <Probe />
        </Actor>
      </ScrollStage>
    );
    // parent 0.5 within [0.25, 0.75] -> local 0.5
    expect(screen.getByTestId('p').textContent).toBe('0.50');
  });
});
