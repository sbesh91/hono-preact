// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ChapterOnePackage } from '../ChapterOnePackage.js';

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));
}

// useInView wires an IntersectionObserver in an effect; happy-dom lacks it, so stub a no-op.
class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IOStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterOnePackage', () => {
  it('renders the heading, the true-claim copy, and the code sample', () => {
    stubMatchMedia(false);
    const { container } = render(<ChapterOnePackage />);

    const heading = container.querySelector('h2.hx-scene__title');
    expect(heading?.textContent).toBe('One package, typed throughout.');

    const desc = container.querySelector('p.hx-scene__desc');
    expect(desc?.textContent).toContain(
      'A single hono-preact install gives you the runtime'
    );

    const code = container.querySelector('pre');
    expect(code?.textContent).toContain(
      "import { honoPreact } from 'hono-preact/vite';"
    );
  });

  it('still renders heading, copy, and the staggered pills with reduced motion (shown immediately)', () => {
    stubMatchMedia(true);
    const { container } = render(<ChapterOnePackage />);

    expect(container.querySelector('h2.hx-scene__title')?.textContent).toBe(
      'One package, typed throughout.'
    );
    expect(container.querySelector('p.hx-scene__desc')?.textContent).toContain(
      'A single hono-preact install gives you the runtime'
    );

    // The package pills are the only animated content, so reduced motion must
    // show them immediately (no in-view gate withholds them).
    const pills = container.querySelectorAll('.hx-pkg-pill');
    expect(Array.from(pills, (n) => n.textContent)).toEqual([
      'hono-preact',
      'hono-preact/server',
      'hono-preact/vite',
      'hono-preact/adapter-*',
    ]);
  });
});
