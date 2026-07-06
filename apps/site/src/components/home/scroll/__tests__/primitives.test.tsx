// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { ScrollStage } from '../stage.js';
import { Lane, BrowserFrame, Region } from '../primitives.js';

afterEach(() => cleanup());

describe('Lane', () => {
  it('renders a labeled bar whose state reflects the fallback playhead', () => {
    render(
      <ScrollStage pages={2} fallbackProgress={1}>
        <Lane label="POST /__loaders" start={0} size={0.5} />
      </ScrollStage>
    );
    const fill = document.querySelector('.hx-lane__fill') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.getAttribute('data-state')).toBe('done'); // progress 1, fully filled
    expect(screen.getByText('POST /__loaders')).toBeInTheDocument();
  });
});

describe('BrowserFrame', () => {
  it('renders chrome with the given url', () => {
    render(
      <BrowserFrame url="example.app / projects">
        <p>body</p>
      </BrowserFrame>
    );
    expect(screen.getByText('example.app / projects')).toBeInTheDocument();
  });
});

describe('Region', () => {
  it('keeps both skeleton and content in the DOM for SSR', () => {
    render(
      <ScrollStage pages={2} fallbackProgress={1}>
        <Region showAt={0.5} skeleton={<span>loading</span>}>
          <span>Invoice #102000</span>
        </Region>
      </ScrollStage>
    );
    expect(screen.getByText('Invoice #102000')).toBeInTheDocument();
    // shown at fallback 1 (>= 0.5)
    expect(
      document.querySelector('.hx-region')?.getAttribute('data-shown')
    ).toBe('true');
  });
});
