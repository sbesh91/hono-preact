// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { ScrollStage } from '../stage.js';
import { Lane, BrowserFrame, Region, Reveal } from '../primitives.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it('shows content (not the skeleton) when no live stage is driving it', () => {
    // Outside a ScrollStage the default context has live: false, which models
    // SSR and a failed client bundle: the skeleton must never be terminal,
    // even when the playhead never reaches showAt.
    render(
      <Region showAt={0.9} skeleton={<span>loading</span>}>
        <span>Invoice #102000</span>
      </Region>
    );
    expect(
      document.querySelector('.hx-region')?.getAttribute('data-shown')
    ).toBe('true');
  });
});

describe('Reveal', () => {
  it('stays in the visible static state when IntersectionObserver is unavailable', () => {
    // No IO models no-JS-capable environments: the reveal must not arm its
    // hidden state, so the content renders visible with no animation gate.
    vi.stubGlobal('IntersectionObserver', undefined);
    render(
      <Reveal>
        <p>chapter body</p>
      </Reveal>
    );
    expect(
      document.querySelector('.hx-reveal')?.getAttribute('data-reveal-state')
    ).toBe('static');
    expect(screen.getByText('chapter body')).toBeInTheDocument();
  });

  it('arms the hidden state after mount when IntersectionObserver exists', () => {
    class IOStub {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('IntersectionObserver', IOStub);
    render(
      <Reveal>
        <p>chapter body</p>
      </Reveal>
    );
    // Armed (hidden, awaiting scroll-in) only because client JS is running.
    expect(
      document.querySelector('.hx-reveal')?.getAttribute('data-reveal-state')
    ).toBe('hidden');
  });
});
